mod commands;
mod config;
mod detector;
mod i18n;
mod pty_manager;

use config::ConfigManager;
use i18n::TrayMenuState;
use pty_manager::PtyManager;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};

pub struct ExitGuard(pub AtomicBool);
pub struct CloseToTray(pub AtomicBool);
pub struct ShutdownStarted(pub AtomicBool);

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn shutdown_gracefully(app: &AppHandle) {
    let exit_guard = app.state::<ExitGuard>();
    exit_guard.0.store(true, Ordering::SeqCst);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    let shutdown_started = app.state::<ShutdownStarted>();
    if shutdown_started.0.swap(true, Ordering::SeqCst) {
        return;
    }

    let app_clone = app.clone();
    thread::spawn(move || {
        let pty = app_clone.state::<PtyManager>();
        pty.stop_all_projects(&app_clone);
        app_clone.exit(0);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }));
    }

    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_manager =
                ConfigManager::init(app.handle().clone()).map_err(std::io::Error::other)?;
            let pty_manager = PtyManager::new();

            app.manage(config_manager);
            app.manage(pty_manager);
            app.manage(ExitGuard(AtomicBool::new(false)));
            app.manage(CloseToTray(AtomicBool::new(true)));
            app.manage(ShutdownStarted(AtomicBool::new(false)));

            let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            app.manage(TrayMenuState {
                show_item: show_item.clone(),
                quit_item: quit_item.clone(),
            });

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("DevPanel · 待机")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        show_main_window(app);
                    }
                    "quit" => {
                        shutdown_gracefully(app);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let exit_guard = window.state::<ExitGuard>();
                if !exit_guard.0.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let close_to_tray = window.state::<CloseToTray>();
                    if close_to_tray.0.load(Ordering::SeqCst) {
                        let _ = window.hide();
                    } else {
                        shutdown_gracefully(window.app_handle());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_project,
            commands::delete_project,
            commands::create_group,
            commands::rename_group,
            commands::delete_group,
            commands::save_binding,
            commands::delete_binding,
            commands::reorder_projects,
            commands::reorder_groups,
            commands::reorder_bindings,
            commands::export_config_file,
            commands::import_config_file,
            commands::export_log_file,
            commands::get_all_statuses,
            commands::get_detected_urls,
            commands::set_pty_subscription,
            commands::start_project,
            commands::stop_project,
            commands::stop_all_project_commands,
            commands::stop_sessions,
            commands::stop_all_projects,
            commands::restart_project,
            commands::write_pty,
            commands::resize_pty,
            commands::get_pty_history,
            commands::clear_pty_history,
            commands::open_directory,
            commands::open_in_editor,
            commands::open_in_external_terminal,
            commands::open_url,
            commands::pick_project_directory,
            commands::detect_project_dir,
            commands::set_close_to_tray,
            commands::set_locale,
            commands::get_platform,
            commands::check_port_in_use,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let shutdown_started = app_handle.state::<ShutdownStarted>();
            if !shutdown_started.0.swap(true, Ordering::SeqCst) {
                let pty = app_handle.state::<PtyManager>();
                pty.stop_all_projects(app_handle);
            }
        }
    });
}
