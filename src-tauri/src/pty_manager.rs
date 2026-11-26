use crate::config::ResolvedCommand;
use crate::i18n;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const MAX_HISTORY_BYTES: usize = 256 * 1024;
const GRACEFUL_TIMEOUT_MS: u64 = 2500;
const OUTPUT_FLUSH_INTERVAL_MS: u64 = 16;
const OUTPUT_FLUSH_MAX_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyOutputEvent {
    pub id: String,
    pub data: String,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyHistoryPayload {
    pub data: String,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyStatusEvent {
    pub id: String,
    pub status: ProjectStatus,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyUrlEvent {
    pub id: String,
    pub url: Option<String>,
}

#[cfg(windows)]
mod win_job {
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    pub struct WindowsJob {
        handle: isize,
    }

    // Win32 Job HANDLE is safe to send/share across threads for assignment and termination.
    unsafe impl Send for WindowsJob {}
    unsafe impl Sync for WindowsJob {}

    impl WindowsJob {
        pub fn new() -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const c_void,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(Self {
                    handle: handle as isize,
                })
            }
        }

        pub fn assign_pid(&self, pid: u32) -> bool {
            unsafe {
                let proc_handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if proc_handle.is_null() {
                    return false;
                }
                let ok = AssignProcessToJobObject(self.handle as HANDLE, proc_handle);
                CloseHandle(proc_handle);
                ok != 0
            }
        }

        pub fn terminate(&self) {
            unsafe {
                let _ = TerminateJobObject(self.handle as HANDLE, 1);
            }
        }
    }

    impl Drop for WindowsJob {
        fn drop(&mut self) {
            unsafe {
                if self.handle != 0 {
                    CloseHandle(self.handle as HANDLE);
                }
            }
        }
    }
}

struct PtySession {
    session_id: u64,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pid: Option<u32>,
    status: ProjectStatus,
    exited: Arc<(Mutex<bool>, Condvar)>,
    #[cfg(windows)]
    job: Option<Arc<win_job::WindowsJob>>,
}

enum SessionEntry {
    Starting { session_id: u64 },
    Active(PtySession),
}

struct SessionHistory {
    buf: VecDeque<u8>,
    total_bytes: u64,
}

impl SessionHistory {
    fn new() -> Self {
        Self {
            buf: VecDeque::with_capacity(64 * 1024),
            total_bytes: 0,
        }
    }
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, SessionEntry>>>,
    history: Arc<Mutex<HashMap<String, SessionHistory>>>,
    subscribed_sessions: Arc<Mutex<HashSet<String>>>,
    detected_urls: Arc<Mutex<HashMap<String, String>>>,
    next_session_id: AtomicU64,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            history: Arc::new(Mutex::new(HashMap::new())),
            subscribed_sessions: Arc::new(Mutex::new(HashSet::new())),
            detected_urls: Arc::new(Mutex::new(HashMap::new())),
            next_session_id: AtomicU64::new(1),
        }
    }

    pub fn get_all_statuses(&self) -> HashMap<String, ProjectStatus> {
        let Ok(guard) = self.sessions.lock() else {
            return HashMap::new();
        };
        guard
            .iter()
            .map(|(id, entry)| {
                let status = match entry {
                    SessionEntry::Starting { .. } => ProjectStatus::Starting,
                    SessionEntry::Active(s) => s.status,
                };
                (id.clone(), status)
            })
            .collect()
    }

    pub fn get_detected_urls(&self) -> HashMap<String, String> {
        self.detected_urls
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn set_subscription(&self, id: &str, subscribed: bool) {
        if let Ok(mut guard) = self.subscribed_sessions.lock() {
            if subscribed {
                guard.insert(id.to_string());
            } else {
                guard.remove(id);
            }
        }
    }

    pub fn get_history(&self, id: &str) -> PtyHistoryPayload {
        let Ok(guard) = self.history.lock() else {
            return PtyHistoryPayload {
                data: String::new(),
                seq: 0,
            };
        };
        let Some(hist) = guard.get(id) else {
            return PtyHistoryPayload {
                data: String::new(),
                seq: 0,
            };
        };
        let (first, second) = hist.buf.as_slices();
        let mut combined = Vec::with_capacity(hist.buf.len());
        combined.extend_from_slice(first);
        combined.extend_from_slice(second);
        PtyHistoryPayload {
            data: BASE64.encode(&combined),
            seq: hist.total_bytes,
        }
    }

    pub fn clear_history(&self, id: &str) {
        if let Ok(mut guard) = self.history.lock()
            && let Some(hist) = guard.get_mut(id)
        {
            hist.buf.clear();
        }
    }

    pub fn remove_project_history(&self, project_id: &str) {
        let prefix = format!("{}::", project_id);
        let matches = |key: &String| key == project_id || key.starts_with(&prefix);
        if let Ok(mut guard) = self.history.lock() {
            guard.retain(|k, _| !matches(k));
        }
        if let Ok(mut guard) = self.detected_urls.lock() {
            guard.retain(|k, _| !matches(k));
        }
        if let Ok(mut guard) = self.subscribed_sessions.lock() {
            guard.retain(|k| !matches(k));
        }
    }

    fn cleanup_starting(&self, app: &AppHandle, session_key: &str, session_id: u64) {
        if let Ok(mut guard) = self.sessions.lock()
            && let Some(SessionEntry::Starting { session_id: sid }) = guard.get(session_key)
            && *sid == session_id
        {
            guard.remove(session_key);
        }
        emit_status(app, session_key, ProjectStatus::Stopped, None);
    }

    pub fn start_command(
        &self,
        app: &AppHandle,
        resolved: &ResolvedCommand,
        default_shell: Option<&str>,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let session_key = &resolved.session_key;
        let session_id = {
            let mut guard = self
                .sessions
                .lock()
                .map_err(|_| i18n::tr("PTY 会话锁异常", "PTY session lock poisoned").to_string())?;
            if let Some(existing) = guard.get(session_key) {
                let busy = match existing {
                    SessionEntry::Starting { .. } => true,
                    SessionEntry::Active(s) => s.status != ProjectStatus::Stopped,
                };
                if busy {
                    return Err(if i18n::is_en() {
                        format!("\"{}\" is already running or transitioning", resolved.display_name)
                    } else {
                        format!("「{}」已在运行或正在切换状态", resolved.display_name)
                    });
                }
            }
            let sid = self.next_session_id.fetch_add(1, Ordering::SeqCst);
            guard.insert(
                session_key.clone(),
                SessionEntry::Starting { session_id: sid },
            );
            sid
        };

        let cwd_path = Path::new(&resolved.cwd);
        if !cwd_path.is_dir() {
            self.cleanup_starting(app, session_key, session_id);
            return Err(if i18n::is_en() {
                format!("Working directory does not exist: {}", resolved.cwd)
            } else {
                format!("工作目录不存在: {}", resolved.cwd)
            });
        }

        emit_status(app, session_key, ProjectStatus::Starting, None);

        let pty_system = native_pty_system();
        let size = PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = match pty_system.openpty(size) {
            Ok(pair) => pair,
            Err(e) => {
                self.cleanup_starting(app, session_key, session_id);
                return Err(if i18n::is_en() {
                    format!("Failed to open PTY: {}", e)
                } else {
                    format!("创建伪终端失败: {}", e)
                });
            }
        };

        let cmd = build_shell_command(resolved, default_shell);
        let mut child = match pair.slave.spawn_command(cmd) {
            Ok(child) => child,
            Err(e) => {
                self.cleanup_starting(app, session_key, session_id);
                return Err(if i18n::is_en() {
                    format!("Failed to spawn process: {}", e)
                } else {
                    format!("启动进程失败: {}", e)
                });
            }
        };
        drop(pair.slave);

        let pid = child.process_id();

        #[cfg(windows)]
        let job = pid.and_then(|p| {
            let j = win_job::WindowsJob::new()?;
            if !j.assign_pid(p) {
                eprintln!("[DevPanel] warning: failed to assign PID {} to Job Object", p);
            }
            Some(Arc::new(j))
        });

        let reader = match pair.master.try_clone_reader() {
            Ok(r) => r,
            Err(e) => {
                self.cleanup_starting(app, session_key, session_id);
                return Err(if i18n::is_en() {
                    format!("Failed to clone PTY reader: {}", e)
                } else {
                    format!("读取 PTY 输出流失败: {}", e)
                });
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(w) => w,
            Err(e) => {
                self.cleanup_starting(app, session_key, session_id);
                return Err(if i18n::is_en() {
                    format!("Failed to take PTY writer: {}", e)
                } else {
                    format!("获取 PTY 输入流失败: {}", e)
                });
            }
        };

        let exited = Arc::new((Mutex::new(false), Condvar::new()));

        if let Ok(mut urls) = self.detected_urls.lock()
            && urls.remove(session_key).is_some()
        {
            emit_url(app, session_key, None);
        }

        let has_prior_history = if let Ok(mut hist_map) = self.history.lock() {
            let entry = hist_map
                .entry(session_key.clone())
                .or_insert_with(SessionHistory::new);
            !entry.buf.is_empty()
        } else {
            false
        };

        if has_prior_history {
            let mut banner = i18n::tr(
                "\r\n\x1b[2m─── [DevPanel] 启动进程 ───\x1b[0m\r\n",
                "\r\n\x1b[2m─── [DevPanel] Starting process ───\x1b[0m\r\n",
            )
            .as_bytes()
            .to_vec();
            flush_output_batch(
                app,
                session_key,
                &self.history,
                &self.subscribed_sessions,
                &self.detected_urls,
                &mut banner,
            );
        }

        {
            let mut guard = self
                .sessions
                .lock()
                .map_err(|_| i18n::tr("PTY 会话锁异常", "PTY session lock poisoned").to_string())?;
            guard.insert(
                session_key.clone(),
                SessionEntry::Active(PtySession {
                    session_id,
                    master: Arc::new(Mutex::new(pair.master)),
                    writer: Arc::new(Mutex::new(writer)),
                    pid,
                    status: ProjectStatus::Running,
                    exited: Arc::clone(&exited),
                    #[cfg(windows)]
                    job,
                }),
            );
        }

        emit_status(app, session_key, ProjectStatus::Running, None);

        // Output reader + coalesced flusher threads
        let (chunk_tx, chunk_rx) = mpsc::channel::<Vec<u8>>();
        thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if chunk_tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let app_out = app.clone();
        let id_out = session_key.clone();
        let history_out = Arc::clone(&self.history);
        let subscribed_out = Arc::clone(&self.subscribed_sessions);
        let urls_out = Arc::clone(&self.detected_urls);
        thread::spawn(move || {
            let mut batch: Vec<u8> = Vec::with_capacity(OUTPUT_FLUSH_MAX_BYTES);
            while let Ok(first) = chunk_rx.recv() {
                batch.extend_from_slice(&first);

                let deadline = Instant::now() + Duration::from_millis(OUTPUT_FLUSH_INTERVAL_MS);
                while batch.len() < OUTPUT_FLUSH_MAX_BYTES {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        break;
                    }
                    match chunk_rx.recv_timeout(remaining) {
                        Ok(more) => batch.extend_from_slice(&more),
                        Err(_) => break,
                    }
                }

                flush_output_batch(
                    &app_out,
                    &id_out,
                    &history_out,
                    &subscribed_out,
                    &urls_out,
                    &mut batch,
                );
            }
            if !batch.is_empty() {
                flush_output_batch(
                    &app_out,
                    &id_out,
                    &history_out,
                    &subscribed_out,
                    &urls_out,
                    &mut batch,
                );
            }
        });

        // Process waiter thread
        let app_wait = app.clone();
        let id_wait = session_key.clone();
        let sessions_wait = Arc::clone(&self.sessions);
        let history_wait = Arc::clone(&self.history);
        let subscribed_wait = Arc::clone(&self.subscribed_sessions);
        let urls_wait = Arc::clone(&self.detected_urls);
        thread::spawn(move || {
            let exit_code = match child.wait() {
                Ok(status) => Some(status.exit_code() as i32),
                Err(_) => None,
            };

            {
                let (lock, cvar) = &*exited;
                if let Ok(mut done) = lock.lock() {
                    *done = true;
                    cvar.notify_all();
                }
            }

            let removed = if let Ok(mut guard) = sessions_wait.lock() {
                let matches = matches!(
                    guard.get(&id_wait),
                    Some(SessionEntry::Active(s)) if s.session_id == session_id
                );
                if matches {
                    guard.remove(&id_wait);
                    true
                } else {
                    false
                }
            } else {
                false
            };

            if removed {
                let exit_msg = match (i18n::is_en(), exit_code) {
                    (true, Some(code)) => format!(
                        "\r\n\x1b[2m─── [DevPanel] Process exited (exit {}) ───\x1b[0m\r\n",
                        code
                    ),
                    (true, None) => {
                        "\r\n\x1b[2m─── [DevPanel] Process exited ───\x1b[0m\r\n".to_string()
                    }
                    (false, Some(code)) => format!(
                        "\r\n\x1b[2m─── [DevPanel] 进程已退出 (exit {}) ───\x1b[0m\r\n",
                        code
                    ),
                    (false, None) => {
                        "\r\n\x1b[2m─── [DevPanel] 进程已退出 ───\x1b[0m\r\n".to_string()
                    }
                };
                let mut bytes = exit_msg.into_bytes();
                flush_output_batch(
                    &app_wait,
                    &id_wait,
                    &history_wait,
                    &subscribed_wait,
                    &urls_wait,
                    &mut bytes,
                );
                emit_status(&app_wait, &id_wait, ProjectStatus::Stopped, exit_code);
            }
        });

        Ok(())
    }

    pub fn write_pty(&self, id: &str, data: &str) -> Result<(), String> {
        let writer = {
            let guard = self
                .sessions
                .lock()
                .map_err(|_| i18n::tr("PTY 会话锁异常", "PTY session lock poisoned").to_string())?;
            let entry = guard
                .get(id)
                .ok_or_else(|| i18n::tr("终端未运行", "Terminal is not running").to_string())?;
            let SessionEntry::Active(session) = entry else {
                return Err(i18n::tr("终端正在初始化", "Terminal is initializing").to_string());
            };
            Arc::clone(&session.writer)
        };

        let mut w = writer
            .lock()
            .map_err(|_| i18n::tr("写入锁异常", "PTY writer lock poisoned").to_string())?;
        w.write_all(data.as_bytes()).map_err(|e| {
            if i18n::is_en() {
                format!("Failed to write to PTY: {}", e)
            } else {
                format!("写入终端失败: {}", e)
            }
        })?;
        w.flush().map_err(|e| {
            if i18n::is_en() {
                format!("Failed to flush PTY input: {}", e)
            } else {
                format!("刷新终端输入失败: {}", e)
            }
        })?;
        Ok(())
    }

    pub fn resize_pty(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let master = {
            let guard = self
                .sessions
                .lock()
                .map_err(|_| i18n::tr("PTY 会话锁异常", "PTY session lock poisoned").to_string())?;
            let Some(SessionEntry::Active(session)) = guard.get(id) else {
                return Ok(());
            };
            Arc::clone(&session.master)
        };

        let m = master
            .lock()
            .map_err(|_| i18n::tr("终端尺寸锁异常", "PTY master lock poisoned").to_string())?;
        m.resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| {
            if i18n::is_en() {
                format!("Failed to resize PTY: {}", e)
            } else {
                format!("调整终端尺寸失败: {}", e)
            }
        })
    }

    pub fn stop_project(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        let snapshot = {
            let mut guard = self
                .sessions
                .lock()
                .map_err(|_| i18n::tr("PTY 会话锁异常", "PTY session lock poisoned").to_string())?;
            let Some(entry) = guard.get_mut(id) else {
                drop(guard);
                emit_status(app, id, ProjectStatus::Stopped, None);
                return Ok(());
            };
            let SessionEntry::Active(session) = entry else {
                return Err(i18n::tr(
                    "终端正在初始化，请稍后再试",
                    "Terminal is still initializing, please try again shortly",
                )
                .to_string());
            };
            session.status = ProjectStatus::Stopping;
            SessionStopHandle {
                id: id.to_string(),
                session_id: session.session_id,
                writer: Arc::clone(&session.writer),
                pid: session.pid,
                exited: Arc::clone(&session.exited),
                #[cfg(windows)]
                job: session.job.clone(),
            }
        };

        emit_status(app, id, ProjectStatus::Stopping, None);

        // Stage 1: Send Ctrl+C (\x03)
        if let Ok(mut w) = snapshot.writer.lock() {
            let _ = w.write_all(b"\x03");
            let _ = w.flush();
        }

        // Wait up to 2.5s for graceful exit
        let exited_gracefully = wait_for_exit(
            &snapshot.exited,
            Duration::from_millis(GRACEFUL_TIMEOUT_MS),
        );

        // Stage 2: Force kill process tree if still alive
        if !exited_gracefully {
            force_kill_process_tree(&snapshot);
        }

        let removed = if let Ok(mut guard) = self.sessions.lock() {
            let matches = matches!(
                guard.get(id),
                Some(SessionEntry::Active(s)) if s.session_id == snapshot.session_id
            );
            if matches {
                guard.remove(id);
                true
            } else {
                false
            }
        } else {
            false
        };

        if removed {
            let mut bytes = i18n::tr(
                "\r\n\x1b[2m─── [DevPanel] 已停止进程 ───\x1b[0m\r\n",
                "\r\n\x1b[2m─── [DevPanel] Process stopped ───\x1b[0m\r\n",
            )
            .as_bytes()
            .to_vec();
            flush_output_batch(
                app,
                id,
                &self.history,
                &self.subscribed_sessions,
                &self.detected_urls,
                &mut bytes,
            );
            emit_status(app, id, ProjectStatus::Stopped, None);
        }

        Ok(())
    }

    pub fn stop_project_sessions(&self, app: &AppHandle, project_id: &str) {
        let prefix = format!("{}::", project_id);
        self.stop_matching_sessions(app, |key| key == project_id || key.starts_with(&prefix));
    }

    pub fn stop_sessions(&self, app: &AppHandle, session_keys: &[String]) {
        if session_keys.is_empty() {
            return;
        }
        let key_set: HashSet<&str> = session_keys.iter().map(String::as_str).collect();
        self.stop_matching_sessions(app, |key| key_set.contains(key));
    }

    pub fn stop_all_projects(&self, app: &AppHandle) {
        self.stop_matching_sessions(app, |_| true);
    }

    fn stop_matching_sessions<F>(&self, app: &AppHandle, mut predicate: F)
    where
        F: FnMut(&str) -> bool,
    {
        let snapshots: Vec<SessionStopHandle> = {
            let Ok(mut guard) = self.sessions.lock() else {
                return;
            };
            guard
                .iter_mut()
                .filter(|(id, _)| predicate(id))
                .filter_map(|(id, entry)| {
                    let SessionEntry::Active(session) = entry else {
                        return None;
                    };
                    session.status = ProjectStatus::Stopping;
                    Some(SessionStopHandle {
                        id: id.clone(),
                        session_id: session.session_id,
                        writer: Arc::clone(&session.writer),
                        pid: session.pid,
                        exited: Arc::clone(&session.exited),
                        #[cfg(windows)]
                        job: session.job.clone(),
                    })
                })
                .collect()
        };

        if snapshots.is_empty() {
            return;
        }

        // Stage 1: Parallel Ctrl+C to all matched running sessions
        for snap in &snapshots {
            emit_status(app, &snap.id, ProjectStatus::Stopping, None);
            if let Ok(mut w) = snap.writer.lock() {
                let _ = w.write_all(b"\x03");
                let _ = w.flush();
            }
        }

        // Shared 2.5s deadline across all exiting sessions
        let deadline = Instant::now() + Duration::from_millis(GRACEFUL_TIMEOUT_MS);
        for snap in &snapshots {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let done = if remaining.is_zero() {
                is_exited(&snap.exited)
            } else {
                wait_for_exit(&snap.exited, remaining)
            };
            if !done {
                force_kill_process_tree(snap);
            }
        }

        let mut stopped_ids = Vec::new();
        if let Ok(mut guard) = self.sessions.lock() {
            for snap in &snapshots {
                let matches = matches!(
                    guard.get(&snap.id),
                    Some(SessionEntry::Active(s)) if s.session_id == snap.session_id
                );
                if matches {
                    guard.remove(&snap.id);
                    stopped_ids.push(snap.id.clone());
                }
            }
        }

        for id in stopped_ids {
            let mut bytes = i18n::tr(
                "\r\n\x1b[2m─── [DevPanel] 已停止进程 ───\x1b[0m\r\n",
                "\r\n\x1b[2m─── [DevPanel] Process stopped ───\x1b[0m\r\n",
            )
            .as_bytes()
            .to_vec();
            flush_output_batch(
                app,
                &id,
                &self.history,
                &self.subscribed_sessions,
                &self.detected_urls,
                &mut bytes,
            );
            emit_status(app, &id, ProjectStatus::Stopped, None);
        }
    }
}

struct SessionStopHandle {
    id: String,
    session_id: u64,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pid: Option<u32>,
    exited: Arc<(Mutex<bool>, Condvar)>,
    #[cfg(windows)]
    job: Option<Arc<win_job::WindowsJob>>,
}

fn build_shell_command(resolved: &ResolvedCommand, default_shell: Option<&str>) -> CommandBuilder {
    let preferred_shell = resolved
        .shell
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            default_shell
                .map(str::trim)
                .filter(|s| !s.is_empty())
        });

    #[cfg(windows)]
    let shell_bin = preferred_shell.unwrap_or("powershell.exe").to_string();

    #[cfg(not(windows))]
    let shell_bin = preferred_shell
        .map(str::to_string)
        .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()));

    let mut cmd = CommandBuilder::new(&shell_bin);
    let shell_name = Path::new(&shell_bin)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&shell_bin)
        .to_ascii_lowercase();

    #[cfg(windows)]
    {
        if matches!(
            shell_name.as_str(),
            "powershell.exe" | "powershell" | "pwsh.exe" | "pwsh"
        ) {
            let utf8_command = format!(
                "[Console]::InputEncoding=[Console]::OutputEncoding=$OutputEncoding=[System.Text.UTF8Encoding]::new($false); {}",
                resolved.command
            );
            cmd.args(["-NoLogo", "-Command", &utf8_command]);
        } else if matches!(shell_name.as_str(), "cmd.exe" | "cmd") {
            cmd.args(["/C", &resolved.command]);
        } else {
            cmd.args(["-c", &resolved.command]);
        }
    }

    #[cfg(not(windows))]
    {
        let _ = shell_name;
        cmd.args(["-lc", &resolved.command]);
    }

    cmd.cwd(&resolved.cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("FORCE_COLOR", "1");
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");
    for (k, v) in &resolved.env {
        cmd.env(k, v);
    }
    cmd
}

fn trim_history_buffer(buf: &mut VecDeque<u8>, max_bytes: usize) {
    if buf.len() <= max_bytes {
        return;
    }
    let excess = buf.len() - max_bytes;
    buf.drain(..excess);

    // Advance past UTF-8 continuation bytes (10xxxxxx)
    while let Some(&b) = buf.front() {
        if (b & 0xC0) == 0x80 {
            buf.pop_front();
        } else {
            break;
        }
    }

    // Snap to next newline within 512 bytes so replayed output doesn't start mid-ANSI sequence
    let mut newline_idx = None;
    let scan_limit = buf.len().min(512);
    for (idx, &b) in buf.iter().take(scan_limit).enumerate() {
        if b == b'\n' {
            newline_idx = Some(idx);
            break;
        }
    }
    if let Some(idx) = newline_idx {
        buf.drain(..=idx);
    }
}

fn strip_ansi_sequences(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    for c in chars.by_ref() {
                        if c == '\x07' {
                            break;
                        }
                    }
                }
                _ => {}
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn extract_local_url(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    if !(text.contains("http://") || text.contains("https://")) {
        return None;
    }
    let clean = strip_ansi_sequences(&text);
    for scheme in ["http://", "https://"] {
        let mut search_from = 0;
        while let Some(rel) = clean[search_from..].find(scheme) {
            let start = search_from + rel;
            let after_scheme = &clean[start + scheme.len()..];
            let lower = after_scheme.to_ascii_lowercase();
            let (normalized_host, host_len) = if lower.starts_with("localhost:") {
                ("localhost", "localhost".len())
            } else if lower.starts_with("127.0.0.1:") {
                ("127.0.0.1", "127.0.0.1".len())
            } else if lower.starts_with("0.0.0.0:") {
                ("localhost", "0.0.0.0".len())
            } else if lower.starts_with("[::1]:") {
                ("[::1]", "[::1]".len())
            } else {
                search_from = start + scheme.len();
                continue;
            };

            let after_colon = &after_scheme[host_len + 1..];
            let port_str: String = after_colon
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(port) = port_str.parse::<u16>()
                && port > 0
            {
                let rest = &after_colon[port_str.len()..];
                let suffix: String = rest
                    .chars()
                    .take_while(|c| {
                        !c.is_whitespace()
                            && !matches!(c, '"' | '\'' | '`' | '<' | '>' | ')' | ']' | ',' | ';')
                    })
                    .collect();
                let clean_suffix = if suffix == "/" { String::new() } else { suffix };
                return Some(format!("{}{}:{}{}", scheme, normalized_host, port, clean_suffix));
            }
            search_from = start + scheme.len();
        }
    }
    None
}

fn flush_output_batch(
    app: &AppHandle,
    id: &str,
    history: &Arc<Mutex<HashMap<String, SessionHistory>>>,
    subscribed_sessions: &Arc<Mutex<HashSet<String>>>,
    detected_urls: &Arc<Mutex<HashMap<String, String>>>,
    batch: &mut Vec<u8>,
) {
    if batch.is_empty() {
        return;
    }

    let seq = if let Ok(mut guard) = history.lock() {
        let hist = guard
            .entry(id.to_string())
            .or_insert_with(SessionHistory::new);
        hist.buf.extend(batch.iter().copied());
        trim_history_buffer(&mut hist.buf, MAX_HISTORY_BYTES);
        hist.total_bytes = hist.total_bytes.saturating_add(batch.len() as u64);
        hist.total_bytes
    } else {
        0
    };

    if let Some(found_url) = extract_local_url(batch)
        && let Ok(mut urls) = detected_urls.lock()
        && urls.get(id) != Some(&found_url)
    {
        urls.insert(id.to_string(), found_url.clone());
        drop(urls);
        emit_url(app, id, Some(found_url));
    }

    let is_subscribed = subscribed_sessions
        .lock()
        .map(|g| g.contains(id))
        .unwrap_or(false);

    if is_subscribed {
        let encoded = BASE64.encode(&batch);
        let _ = app.emit(
            "pty-output",
            PtyOutputEvent {
                id: id.to_string(),
                data: encoded,
                seq,
            },
        );
    }

    batch.clear();
}

fn emit_url(app: &AppHandle, id: &str, url: Option<String>) {
    let _ = app.emit(
        "pty-url-detected",
        PtyUrlEvent {
            id: id.to_string(),
            url,
        },
    );
}

pub(crate) fn refresh_tray_tooltip(app: &AppHandle) {
    if let Some(pty) = app.try_state::<PtyManager>()
        && let Some(tray) = app.tray_by_id("main-tray")
    {
        let active_count = pty
            .get_all_statuses()
            .values()
            .filter(|s| matches!(s, ProjectStatus::Running | ProjectStatus::Starting))
            .count();
        let tip = match (i18n::is_en(), active_count) {
            (true, n) if n > 0 => format!("DevPanel · {} running", n),
            (true, _) => "DevPanel · Idle".to_string(),
            (false, n) if n > 0 => format!("DevPanel · {} 个进程运行中", n),
            (false, _) => "DevPanel · 待机".to_string(),
        };
        let _ = tray.set_tooltip(Some(&tip));
    }
}

fn emit_status(app: &AppHandle, id: &str, status: ProjectStatus, exit_code: Option<i32>) {
    let _ = app.emit(
        "pty-status",
        PtyStatusEvent {
            id: id.to_string(),
            status,
            exit_code,
        },
    );
    refresh_tray_tooltip(app);
}

fn is_exited(exited: &Arc<(Mutex<bool>, Condvar)>) -> bool {
    let (lock, _) = &**exited;
    lock.lock().map(|g| *g).unwrap_or(true)
}

fn wait_for_exit(exited: &Arc<(Mutex<bool>, Condvar)>, timeout: Duration) -> bool {
    let (lock, cvar) = &**exited;
    let Ok(guard) = lock.lock() else {
        return true;
    };
    if *guard {
        return true;
    }
    let result = cvar.wait_timeout_while(guard, timeout, |done| !*done);
    match result {
        Ok((g, _)) => *g,
        Err(_) => true,
    }
}

fn force_kill_process_tree(snap: &SessionStopHandle) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        if let Some(pid) = snap.pid {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        if let Some(job) = &snap.job {
            job.terminate();
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(pid) = snap.pid {
            let pgid_arg = format!("-{}", pid);
            let _ = Command::new("kill").args(["-TERM", &pgid_arg]).output();
            let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).output();
            if wait_for_exit(&snap.exited, Duration::from_millis(400)) {
                return;
            }
            let _ = Command::new("kill").args(["-9", &pgid_arg]).output();
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_history_on_clean_utf8_and_line_boundary() {
        let mut buf = VecDeque::new();
        buf.extend(b"first line\n\x1b[32m\xe4\xb8\xad\xe6\x96\x87\xe6\x97\xa5\xe5\xbf\x97\x1b[0m\nthird line ok\n");
        trim_history_buffer(&mut buf, 22);
        let kept: Vec<u8> = buf.into_iter().collect();
        let text = String::from_utf8(kept).expect("trimmed buffer should be valid UTF-8");
        assert_eq!(text, "third line ok\n");
    }

    #[test]
    fn extracts_local_urls_with_ansi_and_wildcards() {
        assert_eq!(
            extract_local_url(b"  \x1b[32m->\x1b[0m  Local:   \x1b[36mhttp://localhost:5173/\x1b[0m\n"),
            Some("http://localhost:5173".to_string())
        );
        assert_eq!(
            extract_local_url(b"Listening on http://0.0.0.0:8080/api\n"),
            Some("http://localhost:8080/api".to_string())
        );
        assert_eq!(
            extract_local_url(b"Server ready at https://[::1]:8443"),
            Some("https://[::1]:8443".to_string())
        );
        assert_eq!(extract_local_url(b"https://example.com:443"), None);
    }
}
