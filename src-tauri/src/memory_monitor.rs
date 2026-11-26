use crate::pty_manager::ActiveSessionProcessInfo;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemoryInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_percent: f64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryEntry {
    pub pid: u32,
    pub parent_pid: u32,
    pub name: String,
    pub rss_bytes: u64,
    pub private_bytes: u64,
    pub session_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMemoryInfo {
    pub session_key: String,
    pub root_pid: Option<u32>,
    pub rss_bytes: u64,
    pub private_bytes: u64,
    pub process_count: usize,
    pub processes: Vec<ProcessMemoryEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub timestamp_ms: u64,
    pub system: SystemMemoryInfo,
    pub app_rss_bytes: u64,
    pub app_private_bytes: u64,
    pub app_process_count: usize,
    pub managed_total_rss_bytes: u64,
    pub managed_total_private_bytes: u64,
    pub managed_process_count: usize,
    pub sessions: Vec<SessionMemoryInfo>,
    pub top_processes: Vec<ProcessMemoryEntry>,
}

#[derive(Debug, Clone)]
struct RawProcess {
    pid: u32,
    parent_pid: u32,
    name: String,
    rss_bytes: u64,
    private_bytes: u64,
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn build_children_map(raw_processes: &[RawProcess]) -> (HashMap<u32, &RawProcess>, HashMap<u32, Vec<u32>>) {
    let mut proc_map: HashMap<u32, &RawProcess> = HashMap::with_capacity(raw_processes.len());
    let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();

    for proc in raw_processes {
        proc_map.insert(proc.pid, proc);
        if proc.parent_pid != 0 && proc.parent_pid != proc.pid {
            children_map.entry(proc.parent_pid).or_default().push(proc.pid);
        }
    }

    (proc_map, children_map)
}

fn collect_descendants(
    seeds: &[u32],
    children_map: &HashMap<u32, Vec<u32>>,
    proc_map: &HashMap<u32, &RawProcess>,
    exclude: Option<&HashSet<u32>>,
) -> HashSet<u32> {
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();

    for &seed in seeds {
        if seed != 0
            && proc_map.contains_key(&seed)
            && !exclude.is_some_and(|ex| ex.contains(&seed))
            && visited.insert(seed)
        {
            queue.push_back(seed);
        }
    }

    while let Some(pid) = queue.pop_front() {
        if let Some(children) = children_map.get(&pid) {
            for &child_pid in children {
                if proc_map.contains_key(&child_pid)
                    && !exclude.is_some_and(|ex| ex.contains(&child_pid))
                    && visited.insert(child_pid)
                {
                    queue.push_back(child_pid);
                }
            }
        }
    }

    visited
}

fn build_snapshot_from_raw(
    timestamp_ms: u64,
    system: SystemMemoryInfo,
    raw_processes: &[RawProcess],
    active_sessions: &[ActiveSessionProcessInfo],
    self_pid: u32,
    include_top_processes: bool,
    top_limit: usize,
) -> MemorySnapshot {
    let (proc_map, children_map) = build_children_map(raw_processes);

    let mut sessions = Vec::with_capacity(active_sessions.len());
    let mut managed_pids: HashSet<u32> = HashSet::new();
    let mut pid_to_session: HashMap<u32, String> = HashMap::new();

    for active in active_sessions {
        let mut seeds: Vec<u32> = Vec::with_capacity(1 + active.job_pids.len());
        if let Some(root) = active.root_pid {
            seeds.push(root);
        }
        seeds.extend_from_slice(&active.job_pids);

        let session_pids = collect_descendants(&seeds, &children_map, &proc_map, None);

        let mut rss_bytes: u64 = 0;
        let mut private_bytes: u64 = 0;
        let mut processes = Vec::with_capacity(session_pids.len());

        for &pid in &session_pids {
            if let Some(proc) = proc_map.get(&pid) {
                rss_bytes = rss_bytes.saturating_add(proc.rss_bytes);
                private_bytes = private_bytes.saturating_add(proc.private_bytes);
                processes.push(ProcessMemoryEntry {
                    pid: proc.pid,
                    parent_pid: proc.parent_pid,
                    name: proc.name.clone(),
                    rss_bytes: proc.rss_bytes,
                    private_bytes: proc.private_bytes,
                    session_key: Some(active.session_key.clone()),
                });
            }
            managed_pids.insert(pid);
            pid_to_session
                .entry(pid)
                .or_insert_with(|| active.session_key.clone());
        }

        processes.sort_by(|a, b| b.rss_bytes.cmp(&a.rss_bytes).then_with(|| a.pid.cmp(&b.pid)));

        sessions.push(SessionMemoryInfo {
            session_key: active.session_key.clone(),
            root_pid: active.root_pid,
            rss_bytes,
            private_bytes,
            process_count: processes.len(),
            processes,
        });
    }

    sessions.sort_by(|a, b| {
        b.rss_bytes
            .cmp(&a.rss_bytes)
            .then_with(|| a.session_key.cmp(&b.session_key))
    });

    let mut managed_total_rss_bytes: u64 = 0;
    let mut managed_total_private_bytes: u64 = 0;
    for &pid in &managed_pids {
        if let Some(proc) = proc_map.get(&pid) {
            managed_total_rss_bytes = managed_total_rss_bytes.saturating_add(proc.rss_bytes);
            managed_total_private_bytes =
                managed_total_private_bytes.saturating_add(proc.private_bytes);
        }
    }
    let managed_process_count = managed_pids.len();

    let app_pids = collect_descendants(&[self_pid], &children_map, &proc_map, Some(&managed_pids));
    let mut app_rss_bytes: u64 = 0;
    let mut app_private_bytes: u64 = 0;
    for &pid in &app_pids {
        if let Some(proc) = proc_map.get(&pid) {
            app_rss_bytes = app_rss_bytes.saturating_add(proc.rss_bytes);
            app_private_bytes = app_private_bytes.saturating_add(proc.private_bytes);
        }
    }

    let top_processes = if include_top_processes {
        let limit = top_limit.clamp(1, 100);
        let mut entries: Vec<ProcessMemoryEntry> = raw_processes
            .iter()
            .filter(|p| p.rss_bytes > 0)
            .map(|p| ProcessMemoryEntry {
                pid: p.pid,
                parent_pid: p.parent_pid,
                name: p.name.clone(),
                rss_bytes: p.rss_bytes,
                private_bytes: p.private_bytes,
                session_key: pid_to_session.get(&p.pid).cloned(),
            })
            .collect();
        entries.sort_by(|a, b| b.rss_bytes.cmp(&a.rss_bytes).then_with(|| a.pid.cmp(&b.pid)));
        entries.truncate(limit);
        entries
    } else {
        Vec::new()
    };

    MemorySnapshot {
        timestamp_ms,
        system,
        app_rss_bytes,
        app_private_bytes,
        app_process_count: app_pids.len(),
        managed_total_rss_bytes,
        managed_total_private_bytes,
        managed_process_count,
        sessions,
        top_processes,
    }
}

pub fn collect_memory_snapshot(
    active_sessions: &[ActiveSessionProcessInfo],
    include_top_processes: bool,
    top_limit: usize,
) -> MemorySnapshot {
    let timestamp_ms = current_timestamp_ms();
    let self_pid = std::process::id();

    #[cfg(windows)]
    {
        win_impl::collect_snapshot(
            timestamp_ms,
            active_sessions,
            self_pid,
            include_top_processes,
            top_limit,
        )
    }

    #[cfg(target_os = "linux")]
    {
        linux_impl::collect_snapshot(
            timestamp_ms,
            active_sessions,
            self_pid,
            include_top_processes,
            top_limit,
        )
    }

    #[cfg(target_os = "macos")]
    {
        macos_impl::collect_snapshot(
            timestamp_ms,
            active_sessions,
            self_pid,
            include_top_processes,
            top_limit,
        )
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        build_snapshot_from_raw(
            timestamp_ms,
            SystemMemoryInfo::default(),
            &[],
            active_sessions,
            self_pid,
            include_top_processes,
            top_limit,
        )
    }
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    fn collect_system_memory() -> SystemMemoryInfo {
        let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
        let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
        if ok == 0 {
            return SystemMemoryInfo::default();
        }

        let total = status.ullTotalPhys;
        let avail = status.ullAvailPhys.min(total);
        let used = total.saturating_sub(avail);
        let usage_percent = if total > 0 {
            (used as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        let commit_total = status.ullTotalPageFile;
        let commit_avail = status.ullAvailPageFile.min(commit_total);
        let commit_used = commit_total.saturating_sub(commit_avail);
        let swap_total = commit_total.saturating_sub(total);
        let swap_used = commit_used.saturating_sub(used).min(swap_total);

        SystemMemoryInfo {
            total_bytes: total,
            used_bytes: used,
            available_bytes: avail,
            usage_percent,
            swap_total_bytes: swap_total,
            swap_used_bytes: swap_used,
        }
    }

    fn decode_utf16_nul(slice: &[u16]) -> String {
        let len = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
        String::from_utf16_lossy(&slice[..len])
    }

    fn collect_process_table() -> Vec<RawProcess> {
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Vec::new();
        }

        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;

        let mut processes = Vec::with_capacity(256);
        let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) != 0 };
        while has_entry {
            if entry.th32ProcessID != 0 {
                processes.push(RawProcess {
                    pid: entry.th32ProcessID,
                    parent_pid: entry.th32ParentProcessID,
                    name: decode_utf16_nul(&entry.szExeFile),
                    rss_bytes: 0,
                    private_bytes: 0,
                });
            }
            has_entry = unsafe { Process32NextW(snapshot, &mut entry) != 0 };
        }

        unsafe {
            CloseHandle(snapshot);
        }
        processes
    }

    fn query_process_memory(pid: u32) -> Option<(u64, u64)> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }

        let mut counters: PROCESS_MEMORY_COUNTERS_EX = unsafe { std::mem::zeroed() };
        let cb = size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        counters.cb = cb;

        let ok = unsafe {
            K32GetProcessMemoryInfo(
                handle,
                &mut counters as *mut PROCESS_MEMORY_COUNTERS_EX as *mut PROCESS_MEMORY_COUNTERS,
                cb,
            )
        };
        unsafe {
            CloseHandle(handle);
        }

        if ok == 0 {
            return None;
        }

        Some((counters.WorkingSetSize as u64, counters.PrivateUsage as u64))
    }

    pub fn collect_snapshot(
        timestamp_ms: u64,
        active_sessions: &[ActiveSessionProcessInfo],
        self_pid: u32,
        include_top_processes: bool,
        top_limit: usize,
    ) -> MemorySnapshot {
        let system = collect_system_memory();
        let mut raw_processes = collect_process_table();

        if include_top_processes {
            for proc in &mut raw_processes {
                if let Some((rss, priv_bytes)) = query_process_memory(proc.pid) {
                    proc.rss_bytes = rss;
                    proc.private_bytes = priv_bytes;
                }
            }
        } else {
            let (proc_map, children_map) = build_children_map(&raw_processes);
            let mut target_pids = collect_descendants(&[self_pid], &children_map, &proc_map, None);
            for active in active_sessions {
                let mut seeds = Vec::with_capacity(1 + active.job_pids.len());
                if let Some(root) = active.root_pid {
                    seeds.push(root);
                }
                seeds.extend_from_slice(&active.job_pids);
                target_pids.extend(collect_descendants(&seeds, &children_map, &proc_map, None));
            }
            drop(proc_map);

            for proc in &mut raw_processes {
                if target_pids.contains(&proc.pid)
                    && let Some((rss, priv_bytes)) = query_process_memory(proc.pid)
                {
                    proc.rss_bytes = rss;
                    proc.private_bytes = priv_bytes;
                }
            }
        }

        build_snapshot_from_raw(
            timestamp_ms,
            system,
            &raw_processes,
            active_sessions,
            self_pid,
            include_top_processes,
            top_limit,
        )
    }
}

#[cfg_attr(not(any(test, target_os = "linux")), allow(dead_code))]
fn parse_proc_meminfo(content: &str) -> SystemMemoryInfo {
    let mut mem_total_kb: u64 = 0;
    let mut mem_available_kb: Option<u64> = None;
    let mut mem_free_kb: u64 = 0;
    let mut buffers_kb: u64 = 0;
    let mut cached_kb: u64 = 0;
    let mut swap_total_kb: u64 = 0;
    let mut swap_free_kb: u64 = 0;

    for line in content.lines() {
        let Some((key, rest)) = line.split_once(':') else {
            continue;
        };
        let value = rest
            .split_whitespace()
            .next()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        match key.trim() {
            "MemTotal" => mem_total_kb = value,
            "MemAvailable" => mem_available_kb = Some(value),
            "MemFree" => mem_free_kb = value,
            "Buffers" => buffers_kb = value,
            "Cached" => cached_kb = value,
            "SwapTotal" => swap_total_kb = value,
            "SwapFree" => swap_free_kb = value,
            _ => {}
        }
    }

    let total = mem_total_kb.saturating_mul(1024);
    let avail_kb = mem_available_kb
        .unwrap_or_else(|| mem_free_kb.saturating_add(buffers_kb).saturating_add(cached_kb));
    let avail = avail_kb.saturating_mul(1024).min(total);
    let used = total.saturating_sub(avail);
    let usage_percent = if total > 0 {
        (used as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let swap_total = swap_total_kb.saturating_mul(1024);
    let swap_free = swap_free_kb.saturating_mul(1024).min(swap_total);
    let swap_used = swap_total.saturating_sub(swap_free);

    SystemMemoryInfo {
        total_bytes: total,
        used_bytes: used,
        available_bytes: avail,
        usage_percent,
        swap_total_bytes: swap_total,
        swap_used_bytes: swap_used,
    }
}

#[cfg_attr(not(any(test, target_os = "linux")), allow(dead_code))]
fn parse_proc_stat(stat_content: &str, page_size: u64) -> Option<(u32, u32, String, u64)> {
    let open_paren = stat_content.find('(')?;
    let close_paren = stat_content.rfind(')')?;
    if close_paren <= open_paren {
        return None;
    }

    let pid = stat_content[..open_paren].trim().parse::<u32>().ok()?;
    let name = stat_content[open_paren + 1..close_paren].to_string();
    let after = stat_content[close_paren + 1..].trim_start();
    let fields: Vec<&str> = after.split_whitespace().collect();
    // After ')': field 0=state, 1=ppid, ..., 21=rss (in pages)
    if fields.len() <= 21 {
        return None;
    }
    let parent_pid = fields[1].parse::<u32>().ok()?;
    let rss_pages = fields[21].parse::<u64>().ok()?;
    let rss_bytes = rss_pages.saturating_mul(page_size);

    Some((pid, parent_pid, name, rss_bytes))
}

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::*;
    use std::fs;

    fn read_page_size() -> u64 {
        if let Ok(smaps) = fs::read_to_string("/proc/self/statm") {
            let _ = smaps;
        }
        4096
    }

    fn collect_processes(page_size: u64) -> Vec<RawProcess> {
        let Ok(entries) = fs::read_dir("/proc") else {
            return Vec::new();
        };

        let mut processes = Vec::new();
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let Some(pid_str) = file_name.to_str() else {
                continue;
            };
            if !pid_str.bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            let stat_path = entry.path().join("stat");
            let Ok(stat_content) = fs::read_to_string(stat_path) else {
                continue;
            };
            let Some((pid, parent_pid, name, rss_bytes)) = parse_proc_stat(&stat_content, page_size)
            else {
                continue;
            };
            processes.push(RawProcess {
                pid,
                parent_pid,
                name,
                rss_bytes,
                private_bytes: rss_bytes,
            });
        }
        processes
    }

    pub fn collect_snapshot(
        timestamp_ms: u64,
        active_sessions: &[ActiveSessionProcessInfo],
        self_pid: u32,
        include_top_processes: bool,
        top_limit: usize,
    ) -> MemorySnapshot {
        let system = fs::read_to_string("/proc/meminfo")
            .map(|c| parse_proc_meminfo(&c))
            .unwrap_or_default();
        let page_size = read_page_size();
        let raw_processes = collect_processes(page_size);

        build_snapshot_from_raw(
            timestamp_ms,
            system,
            &raw_processes,
            active_sessions,
            self_pid,
            include_top_processes,
            top_limit,
        )
    }
}

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
fn parse_macos_vm_stat(
    total_bytes: u64,
    vm_stat_output: &str,
    swap_output: Option<&str>,
) -> SystemMemoryInfo {
    let mut page_size: u64 = 16384;
    if let Some(first_line) = vm_stat_output.lines().next()
        && let Some(idx) = first_line.find("page size of ")
    {
        let after = &first_line[idx + "page size of ".len()..];
        if let Some(num) = after.split_whitespace().next().and_then(|s| s.parse::<u64>().ok()) {
            page_size = num;
        }
    }

    let mut active: u64 = 0;
    let mut wired: u64 = 0;
    let mut compressed: u64 = 0;
    let mut inactive: u64 = 0;
    let mut free: u64 = 0;
    let mut speculative: u64 = 0;

    for line in vm_stat_output.lines() {
        let Some((key, val_part)) = line.split_once(':') else {
            continue;
        };
        let pages = val_part
            .trim()
            .trim_end_matches('.')
            .parse::<u64>()
            .unwrap_or(0);
        match key.trim() {
            "Pages active" => active = pages,
            "Pages wired down" => wired = pages,
            "Pages occupied by compressor" => compressed = pages,
            "Pages inactive" => inactive = pages,
            "Pages free" => free = pages,
            "Pages speculative" => speculative = pages,
            _ => {}
        }
    }

    let used_pages = active.saturating_add(wired).saturating_add(compressed);
    let mut used = used_pages.saturating_mul(page_size);
    if total_bytes > 0 {
        used = used.min(total_bytes);
    }
    let avail = if total_bytes > 0 {
        total_bytes.saturating_sub(used)
    } else {
        free.saturating_add(inactive)
            .saturating_add(speculative)
            .saturating_mul(page_size)
    };
    let usage_percent = if total_bytes > 0 {
        (used as f64 / total_bytes as f64) * 100.0
    } else {
        0.0
    };

    let mut swap_total_bytes = 0;
    let mut swap_used_bytes = 0;
    if let Some(swap) = swap_output {
        swap_total_bytes = parse_macos_size_field(swap, "total = ");
        swap_used_bytes = parse_macos_size_field(swap, "used = ");
    }

    SystemMemoryInfo {
        total_bytes,
        used_bytes: used,
        available_bytes: avail,
        usage_percent,
        swap_total_bytes,
        swap_used_bytes,
    }
}

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
fn parse_macos_size_field(text: &str, prefix: &str) -> u64 {
    let Some(idx) = text.find(prefix) else {
        return 0;
    };
    let token = text[idx + prefix.len()..]
        .split_whitespace()
        .next()
        .unwrap_or("");
    let num_end = token
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(token.len());
    let Ok(val) = token[..num_end].parse::<f64>() else {
        return 0;
    };
    let unit = token[num_end..].to_ascii_uppercase();
    let mult = match unit.as_str() {
        "G" | "GB" => 1024.0 * 1024.0 * 1024.0,
        "M" | "MB" => 1024.0 * 1024.0,
        "K" | "KB" => 1024.0,
        _ => 1.0,
    };
    (val * mult) as u64
}

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
fn parse_ps_output(output: &str) -> Vec<RawProcess> {
    let mut list = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut parts = trimmed.splitn(4, char::is_whitespace);
        let Some(pid_str) = parts.next() else {
            continue;
        };
        let rest1 = parts.next().unwrap_or("").trim_start();
        // Because splitn(4, whitespace) splits on single whitespace, re-parse cleanly:
        let _ = (pid_str, rest1);
        let mut tokens = trimmed.split_whitespace();
        let Some(pid) = tokens.next().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let Some(ppid) = tokens.next().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let Some(rss_kb) = tokens.next().and_then(|s| s.parse::<u64>().ok()) else {
            continue;
        };
        let Some(comm_start) = tokens.next() else {
            continue;
        };
        let mut comm = comm_start.to_string();
        for t in tokens {
            comm.push(' ');
            comm.push_str(t);
        }
        let short_name = comm
            .rsplit('/')
            .next()
            .unwrap_or(&comm)
            .to_string();
        let rss_bytes = rss_kb.saturating_mul(1024);
        list.push(RawProcess {
            pid,
            parent_pid: ppid,
            name: short_name,
            rss_bytes,
            private_bytes: rss_bytes,
        });
    }
    list
}

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::*;
    use std::process::Command;

    fn run_stdout(cmd: &str, args: &[&str]) -> Option<String> {
        let out = Command::new(cmd).args(args).output().ok()?;
        if !out.status.success() {
            return None;
        }
        Some(String::from_utf8_lossy(&out.stdout).to_string())
    }

    pub fn collect_snapshot(
        timestamp_ms: u64,
        active_sessions: &[ActiveSessionProcessInfo],
        self_pid: u32,
        include_top_processes: bool,
        top_limit: usize,
    ) -> MemorySnapshot {
        let total_bytes = run_stdout("sysctl", &["-n", "hw.memsize"])
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let vm_stat = run_stdout("vm_stat", &[]).unwrap_or_default();
        let swap = run_stdout("sysctl", &["-n", "vm.swapusage"]);
        let system = parse_macos_vm_stat(total_bytes, &vm_stat, swap.as_deref());

        let raw_processes = run_stdout("ps", &["-axo", "pid=,ppid=,rss=,comm="])
            .map(|out| parse_ps_output(&out))
            .unwrap_or_default();

        build_snapshot_from_raw(
            timestamp_ms,
            system,
            &raw_processes,
            active_sessions,
            self_pid,
            include_top_processes,
            top_limit,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_proc(pid: u32, ppid: u32, name: &str, rss_mb: u64, priv_mb: u64) -> RawProcess {
        RawProcess {
            pid,
            parent_pid: ppid,
            name: name.to_string(),
            rss_bytes: rss_mb * 1024 * 1024,
            private_bytes: priv_mb * 1024 * 1024,
        }
    }

    #[test]
    fn aggregates_process_trees_and_excludes_managed_from_app() {
        let raw = vec![
            mk_proc(100, 1, "devpanel.exe", 60, 40),
            mk_proc(101, 100, "msedgewebview2.exe", 140, 110),
            mk_proc(200, 100, "pwsh.exe", 30, 20),
            mk_proc(201, 200, "node.exe", 220, 190),
            mk_proc(202, 201, "esbuild.exe", 50, 45),
            mk_proc(300, 1, "chrome.exe", 500, 400),
        ];

        let sessions = vec![ActiveSessionProcessInfo {
            session_key: "web-app".to_string(),
            root_pid: Some(200),
            job_pids: vec![200, 201],
        }];

        let system = SystemMemoryInfo {
            total_bytes: 16 * 1024 * 1024 * 1024,
            used_bytes: 8 * 1024 * 1024 * 1024,
            available_bytes: 8 * 1024 * 1024 * 1024,
            usage_percent: 50.0,
            swap_total_bytes: 0,
            swap_used_bytes: 0,
        };

        let snap = build_snapshot_from_raw(12345, system, &raw, &sessions, 100, true, 10);

        assert_eq!(snap.app_process_count, 2);
        assert_eq!(snap.app_rss_bytes, (60 + 140) * 1024 * 1024);
        assert_eq!(snap.app_private_bytes, (40 + 110) * 1024 * 1024);

        assert_eq!(snap.managed_process_count, 3);
        assert_eq!(snap.managed_total_rss_bytes, (30 + 220 + 50) * 1024 * 1024);
        assert_eq!(snap.sessions.len(), 1);
        assert_eq!(snap.sessions[0].session_key, "web-app");
        assert_eq!(snap.sessions[0].processes[0].pid, 201);

        assert_eq!(snap.top_processes.len(), 6);
        assert_eq!(snap.top_processes[0].pid, 300);
        assert_eq!(snap.top_processes[0].session_key, None);
        assert_eq!(snap.top_processes[1].pid, 201);
        assert_eq!(
            snap.top_processes[1].session_key.as_deref(),
            Some("web-app")
        );
    }

    #[test]
    fn unions_job_pids_and_handles_parent_cycles() {
        let raw = vec![
            mk_proc(10, 20, "orphan-a", 50, 50),
            mk_proc(20, 10, "orphan-b", 25, 25),
            mk_proc(30, 1, "job-escaped", 100, 90),
        ];

        let sessions = vec![ActiveSessionProcessInfo {
            session_key: "svc".to_string(),
            root_pid: Some(10),
            job_pids: vec![10, 30, 9999],
        }];

        let snap = build_snapshot_from_raw(
            0,
            SystemMemoryInfo::default(),
            &raw,
            &sessions,
            999,
            false,
            10,
        );

        assert_eq!(snap.managed_process_count, 3);
        assert_eq!(snap.managed_total_rss_bytes, 175 * 1024 * 1024);
        assert!(snap.top_processes.is_empty());
    }

    #[test]
    fn parses_linux_proc_meminfo_and_stat() {
        let meminfo = "\
MemTotal:       16384000 kB
MemFree:         2000000 kB
MemAvailable:    8192000 kB
Buffers:          500000 kB
Cached:          4000000 kB
SwapTotal:       2097152 kB
SwapFree:        1048576 kB
";
        let sys = parse_proc_meminfo(meminfo);
        assert_eq!(sys.total_bytes, 16_384_000 * 1024);
        assert_eq!(sys.available_bytes, 8_192_000 * 1024);
        assert_eq!(sys.used_bytes, 8_192_000 * 1024);
        assert!((sys.usage_percent - 50.0).abs() < 0.01);
        assert_eq!(sys.swap_total_bytes, 2_097_152 * 1024);
        assert_eq!(sys.swap_used_bytes, 1_048_576 * 1024);

        let stat = "4321 (Web Content (GPU)) S 1234 4321 4321 0 -1 4194304 100 0 0 0 10 2 0 0 20 0 8 0 12345 999999 1024 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 1 0 0 0 0 0";
        let (pid, ppid, name, rss) = parse_proc_stat(stat, 4096).expect("valid stat");
        assert_eq!(pid, 4321);
        assert_eq!(ppid, 1234);
        assert_eq!(name, "Web Content (GPU)");
        assert_eq!(rss, 1024 * 4096);
    }

    #[test]
    fn parses_macos_vm_stat_and_ps_output() {
        let vm_stat = "\
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            100000.
Pages inactive:                           50000.
Pages speculative:                         2000.
Pages wired down:                         50000.
Pages occupied by compressor:             25000.
";
        let swap = "total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)";
        let total = 16 * 1024 * 1024 * 1024;
        let sys = parse_macos_vm_stat(total, vm_stat, Some(swap));
        assert_eq!(sys.total_bytes, total);
        assert_eq!(sys.used_bytes, (100_000 + 50_000 + 25_000) * 16384);
        assert_eq!(sys.swap_total_bytes, 2048 * 1024 * 1024);
        assert_eq!(sys.swap_used_bytes, 512 * 1024 * 1024);

        let ps = "\
  101     1  65536 /Applications/DevPanel.app/Contents/MacOS/DevPanel
  205   101 131072 /usr/local/bin/node server.js
";
        let procs = parse_ps_output(ps);
        assert_eq!(procs.len(), 2);
        assert_eq!(procs[0].pid, 101);
        assert_eq!(procs[0].name, "DevPanel");
        assert_eq!(procs[0].rss_bytes, 65536 * 1024);
        assert_eq!(procs[1].pid, 205);
        assert_eq!(procs[1].parent_pid, 101);
        assert_eq!(procs[1].name, "node server.js");
    }

    #[test]
    fn live_memory_snapshot_succeeds_for_current_process() {
        let snap = collect_memory_snapshot(&[], false, 10);
        assert!(snap.system.total_bytes > 0);
        assert!(snap.app_rss_bytes > 0);
        assert!(snap.app_process_count >= 1);
    }
}
