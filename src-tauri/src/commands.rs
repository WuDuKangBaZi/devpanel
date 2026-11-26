use crate::config::{
    make_session_key, ConfigManager, ConfigPayload, LaunchBinding, ProjectConfig,
};
use crate::detector::{self, DetectedProject};
use crate::i18n::{self, TrayMenuState};
use crate::pty_manager::{self, ProjectStatus, PtyHistoryPayload, PtyManager};
use crate::CloseToTray;
use std::collections::HashMap;
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_config(config: State<'_, ConfigManager>) -> ConfigPayload {
    config.get_payload()
}

#[tauri::command]
pub async fn save_project(
    app: AppHandle,
    config: State<'_, ConfigManager>,
    project: ProjectConfig,
    previous_id: Option<String>,
) -> Result<ConfigPayload, String> {
    let trimmed_prev = previous_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let new_id = project.id.trim().to_string();

    if let Some(old_id) = trimmed_prev.as_ref()
        && old_id != &new_id
    {
        let app_clone = app.clone();
        let old_clone = old_id.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let state = app_clone.state::<PtyManager>();
            state.stop_project_sessions(&app_clone, &old_clone);
            state.remove_project_history(&old_clone);
        })
        .await;
    }

    config.upsert_project(project, trimmed_prev.as_deref())
}

#[tauri::command]
pub async fn delete_project(
    app: AppHandle,
    config: State<'_, ConfigManager>,
    id: String,
) -> Result<ConfigPayload, String> {
    let app_clone = app.clone();
    let id_clone = id.clone();

    // Ensure all active PTY processes and buffers for this project are cleaned up before deleting
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let state = app_clone.state::<PtyManager>();
        state.stop_project_sessions(&app_clone, &id_clone);
        state.remove_project_history(&id_clone);
    })
    .await;

    config.delete_project(&id)
}

#[tauri::command]
pub fn create_group(config: State<'_, ConfigManager>, name: String) -> Result<ConfigPayload, String> {
    config.create_group(&name)
}

#[tauri::command]
pub fn rename_group(
    config: State<'_, ConfigManager>,
    old_name: String,
    new_name: String,
) -> Result<ConfigPayload, String> {
    config.rename_group(&old_name, &new_name)
}

#[tauri::command]
pub fn delete_group(config: State<'_, ConfigManager>, name: String) -> Result<ConfigPayload, String> {
    config.delete_group(&name)
}

#[tauri::command]
pub fn save_binding(
    config: State<'_, ConfigManager>,
    binding: LaunchBinding,
) -> Result<ConfigPayload, String> {
    config.upsert_binding(binding)
}

#[tauri::command]
pub fn delete_binding(config: State<'_, ConfigManager>, id: String) -> Result<ConfigPayload, String> {
    config.delete_binding(&id)
}

#[tauri::command]
pub fn reorder_projects(
    config: State<'_, ConfigManager>,
    ordered_ids: Vec<String>,
) -> Result<ConfigPayload, String> {
    config.reorder_projects(&ordered_ids)
}

#[tauri::command]
pub fn reorder_groups(
    config: State<'_, ConfigManager>,
    ordered_names: Vec<String>,
) -> Result<ConfigPayload, String> {
    config.reorder_groups(&ordered_names)
}

#[tauri::command]
pub fn reorder_bindings(
    config: State<'_, ConfigManager>,
    ordered_ids: Vec<String>,
) -> Result<ConfigPayload, String> {
    config.reorder_bindings(&ordered_ids)
}

#[tauri::command]
pub async fn export_config_file(
    app: AppHandle,
    config: State<'_, ConfigManager>,
) -> Result<Option<String>, String> {
    let json = config.export_json()?;
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title(i18n::tr("导出 DevPanel 配置", "Export DevPanel Config"))
            .set_file_name("devpanel-projects.json")
            .add_filter("JSON", &["json"])
            .blocking_save_file();
        let Some(file_path) = picked else {
            return Ok(None);
        };
        let path = file_path.into_path().map_err(|e| {
            if i18n::is_en() {
                format!("Failed to resolve save path: {}", e)
            } else {
                format!("无法解析保存路径: {}", e)
            }
        })?;
        fs::write(&path, json).map_err(|e| {
            if i18n::is_en() {
                format!("Failed to write exported config: {}", e)
            } else {
                format!("写入导出文件失败: {}", e)
            }
        })?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Export task failed: {}", e)
        } else {
            format!("导出任务异常: {}", e)
        }
    })?
}

#[tauri::command]
pub async fn import_config_file(
    app: AppHandle,
    config: State<'_, ConfigManager>,
    replace: bool,
) -> Result<Option<ConfigPayload>, String> {
    let picked_content = tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title(i18n::tr("导入 DevPanel 配置", "Import DevPanel Config"))
            .add_filter("JSON", &["json"])
            .blocking_pick_file();
        let Some(file_path) = picked else {
            return Ok::<Option<String>, String>(None);
        };
        let path = file_path.into_path().map_err(|e| {
            if i18n::is_en() {
                format!("Failed to resolve import path: {}", e)
            } else {
                format!("无法解析导入路径: {}", e)
            }
        })?;
        let raw = fs::read_to_string(&path).map_err(|e| {
            if i18n::is_en() {
                format!("Failed to read import file: {}", e)
            } else {
                format!("读取导入文件失败: {}", e)
            }
        })?;
        Ok(Some(raw))
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Import task failed: {}", e)
        } else {
            format!("导入任务异常: {}", e)
        }
    })??;

    let Some(raw) = picked_content else {
        return Ok(None);
    };

    config.import_json(&raw, replace).map(Some)
}

#[tauri::command]
pub async fn export_log_file(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title(i18n::tr("导出终端日志", "Export Terminal Log"))
            .set_file_name(&default_name)
            .add_filter(i18n::tr("日志文件", "Log Files"), &["log", "txt"])
            .blocking_save_file();
        let Some(file_path) = picked else {
            return Ok(None);
        };
        let path = file_path.into_path().map_err(|e| {
            if i18n::is_en() {
                format!("Failed to resolve save path: {}", e)
            } else {
                format!("无法解析保存路径: {}", e)
            }
        })?;
        fs::write(&path, content).map_err(|e| {
            if i18n::is_en() {
                format!("Failed to write log file: {}", e)
            } else {
                format!("写入日志文件失败: {}", e)
            }
        })?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Log export task failed: {}", e)
        } else {
            format!("导出日志任务异常: {}", e)
        }
    })?
}

#[tauri::command]
pub fn get_all_statuses(pty: State<'_, PtyManager>) -> HashMap<String, ProjectStatus> {
    pty.get_all_statuses()
}

#[tauri::command]
pub fn get_detected_urls(pty: State<'_, PtyManager>) -> HashMap<String, String> {
    pty.get_detected_urls()
}

#[tauri::command]
pub fn set_pty_subscription(pty: State<'_, PtyManager>, id: String, subscribed: bool) {
    pty.set_subscription(&id, subscribed);
}

#[tauri::command]
pub async fn start_project(
    app: AppHandle,
    config: State<'_, ConfigManager>,
    id: String,
    command_id: Option<String>,
    default_shell: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let project = config.get_project(&id).ok_or_else(|| {
        if i18n::is_en() {
            format!("Project not found: {}", id)
        } else {
            format!("未找到项目: {}", id)
        }
    })?;
    let resolved = project.resolve_command(command_id.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let pty = app.state::<PtyManager>();
        pty.start_command(&app, &resolved, default_shell.as_deref(), cols, rows)
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Background task failed: {}", e)
        } else {
            format!("后台任务执行失败: {}", e)
        }
    })?
}

#[tauri::command]
pub async fn stop_project(
    app: AppHandle,
    id: String,
    command_id: Option<String>,
) -> Result<(), String> {
    let session_key = make_session_key(&id, command_id.as_deref());
    tauri::async_runtime::spawn_blocking(move || {
        let pty = app.state::<PtyManager>();
        pty.stop_project(&app, &session_key)
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Background task failed: {}", e)
        } else {
            format!("后台任务执行失败: {}", e)
        }
    })?
}

#[tauri::command]
pub async fn stop_all_project_commands(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pty = app.state::<PtyManager>();
        pty.stop_project_sessions(&app, &id);
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Background task failed: {}", e)
        } else {
            format!("后台任务执行失败: {}", e)
        }
    })
}

#[tauri::command]
pub async fn stop_sessions(app: AppHandle, session_keys: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pty = app.state::<PtyManager>();
        pty.stop_sessions(&app, &session_keys);
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Background task failed: {}", e)
        } else {
            format!("后台任务执行失败: {}", e)
        }
    })
}

#[tauri::command]
pub async fn stop_all_projects(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pty = app.state::<PtyManager>();
        pty.stop_all_projects(&app);
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Background task failed: {}", e)
        } else {
            format!("后台任务执行失败: {}", e)
        }
    })
}

#[tauri::command]
pub async fn restart_project(
    app: AppHandle,
    config: State<'_, ConfigManager>,
    id: String,
    command_id: Option<String>,
    default_shell: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let project = config.get_project(&id).ok_or_else(|| {
        if i18n::is_en() {
            format!("Project not found: {}", id)
        } else {
            format!("未找到项目: {}", id)
        }
    })?;
    let resolved = project.resolve_command(command_id.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let pty = app.state::<PtyManager>();
        pty.stop_project(&app, &resolved.session_key)?;
        thread::sleep(Duration::from_millis(150));
        pty.start_command(&app, &resolved, default_shell.as_deref(), cols, rows)
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Background task failed: {}", e)
        } else {
            format!("后台任务执行失败: {}", e)
        }
    })?
}

#[tauri::command]
pub fn write_pty(pty: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    pty.write_pty(&id, &data)
}

#[tauri::command]
pub fn resize_pty(
    pty: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty.resize_pty(&id, cols, rows)
}

#[tauri::command]
pub fn get_pty_history(pty: State<'_, PtyManager>, id: String) -> PtyHistoryPayload {
    pty.get_history(&id)
}

#[tauri::command]
pub fn clear_pty_history(pty: State<'_, PtyManager>, id: String) {
    pty.clear_history(&id);
}

#[tauri::command]
pub fn open_directory(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(|e| {
        if i18n::is_en() {
            format!("Failed to open directory: {}", e)
        } else {
            format!("打开目录失败: {}", e)
        }
    })
}

#[tauri::command]
pub fn open_in_editor(path: String, editor: Option<String>) -> Result<(), String> {
    let dir = Path::new(&path);
    if !dir.exists() {
        return Err(if i18n::is_en() {
            format!("Path does not exist: {}", path)
        } else {
            format!("路径不存在: {}", path)
        });
    }
    let bin = editor
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("code");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let resolved_bin = if matches!(
            bin.to_ascii_lowercase().as_str(),
            "code" | "cursor" | "windsurf"
        ) {
            format!("{}.cmd", bin)
        } else {
            bin.to_string()
        };
        Command::new(&resolved_bin)
            .arg(&path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .or_else(|_| {
                Command::new(bin)
                    .arg(&path)
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
            })
            .map_err(|e| {
                if i18n::is_en() {
                    format!("Failed to launch editor ({}): {}", bin, e)
                } else {
                    format!("无法启动编辑器 ({}): {}", bin, e)
                }
            })?;
    }

    #[cfg(not(windows))]
    {
        Command::new(bin).arg(&path).spawn().map_err(|e| {
            if i18n::is_en() {
                format!("Failed to launch editor ({}): {}", bin, e)
            } else {
                format!("无法启动编辑器 ({}): {}", bin, e)
            }
        })?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_in_external_terminal(path: String, shell: Option<String>) -> Result<(), String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(if i18n::is_en() {
            format!("Working directory does not exist: {}", path)
        } else {
            format!("工作目录不存在: {}", path)
        });
    }

    #[cfg(windows)]
    {
        let shell_bin = shell
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("powershell.exe");
        let lower = shell_bin.to_ascii_lowercase();
        if lower.contains("cmd") {
            Command::new("cmd.exe")
                .args(["/C", "start", "cmd.exe", "/K"])
                .current_dir(dir)
                .spawn()
                .map_err(|e| {
                    if i18n::is_en() {
                        format!("Failed to open external terminal: {}", e)
                    } else {
                        format!("打开外部终端失败: {}", e)
                    }
                })?;
        } else {
            let ps_bin = if lower.contains("pwsh") {
                "pwsh.exe"
            } else {
                "powershell.exe"
            };
            Command::new("cmd.exe")
                .args(["/C", "start", ps_bin, "-NoExit"])
                .current_dir(dir)
                .spawn()
                .map_err(|e| {
                    if i18n::is_en() {
                        format!("Failed to open external terminal: {}", e)
                    } else {
                        format!("打开外部终端失败: {}", e)
                    }
                })?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        let _ = shell;
        Command::new("open")
            .args(["-a", "Terminal", &path])
            .spawn()
            .map_err(|e| {
                if i18n::is_en() {
                    format!("Failed to open external terminal: {}", e)
                } else {
                    format!("打开外部终端失败: {}", e)
                }
            })?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = shell;
        let mut launched = false;
        for term in [
            "x-terminal-emulator",
            "gnome-terminal",
            "konsole",
            "xfce4-terminal",
            "alacritty",
            "kitty",
        ] {
            if Command::new(term).current_dir(dir).spawn().is_ok() {
                launched = true;
                break;
            }
        }
        if !launched {
            return Err(
                i18n::tr(
                    "未找到可用的系统终端模拟器",
                    "No compatible system terminal emulator found",
                )
                .to_string(),
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err(
            i18n::tr(
                "仅支持打开 http:// 或 https:// 开头的地址",
                "Only http:// and https:// URLs are supported",
            )
            .to_string(),
        );
    }
    app.opener().open_url(trimmed, None::<&str>).map_err(|e| {
        if i18n::is_en() {
            format!("Failed to open browser: {}", e)
        } else {
            format!("打开浏览器失败: {}", e)
        }
    })
}

#[tauri::command]
pub async fn pick_project_directory(app: AppHandle) -> Result<Option<DetectedProject>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title(i18n::tr("选择项目目录", "Select Project Directory"))
            .blocking_pick_folder();
        let Some(file_path) = picked else {
            return Ok(None);
        };
        let path = file_path.into_path().map_err(|e| {
            if i18n::is_en() {
                format!("Failed to resolve selected folder: {}", e)
            } else {
                format!("无法解析所选目录路径: {}", e)
            }
        })?;
        let detected = detector::detect_project(&path)?;
        Ok(Some(detected))
    })
    .await
    .map_err(|e| {
        if i18n::is_en() {
            format!("Directory picker task failed: {}", e)
        } else {
            format!("目录选择任务异常: {}", e)
        }
    })?
}

#[tauri::command]
pub async fn detect_project_dir(cwd: String) -> Result<DetectedProject, String> {
    let trimmed = cwd.trim().to_string();
    if trimmed.is_empty() {
        return Err(
            i18n::tr("请先输入项目目录路径", "Please enter a project folder path").to_string(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || detector::detect_project(Path::new(&trimmed)))
        .await
        .map_err(|e| {
            if i18n::is_en() {
                format!("Project detection task failed: {}", e)
            } else {
                format!("目录识别任务异常: {}", e)
            }
        })?
}

#[tauri::command]
pub fn set_close_to_tray(state: State<'_, CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_locale(app: AppHandle, locale: String) {
    let parsed = i18n::parse_locale(&locale);
    i18n::set_current_locale(parsed);
    if let Some(menu_state) = app.try_state::<TrayMenuState>() {
        let _ = menu_state
            .show_item
            .set_text(i18n::tr("显示窗口", "Show Window"));
        let _ = menu_state
            .quit_item
            .set_text(i18n::tr("彻底退出", "Quit DevPanel"));
    }
    pty_manager::refresh_tray_tooltip(&app);
}

#[tauri::command]
pub fn get_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

#[tauri::command]
pub async fn check_port_in_use(port: u16) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let addrs = [
            SocketAddr::from(([127, 0, 0, 1], port)),
            SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
        ];
        addrs
            .iter()
            .any(|addr| TcpStream::connect_timeout(addr, Duration::from_millis(120)).is_ok())
    })
    .await
    .unwrap_or(false)
}
