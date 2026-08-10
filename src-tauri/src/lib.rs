use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

/// File path waiting to be picked up by the frontend once it has mounted.
/// Cold-start opens (Finder double-click before the webview exists) land here;
/// warm opens are additionally delivered via the `open-file` event.
struct PendingOpen(Mutex<Option<String>>);

fn resolve_markdown_path(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    if ext != "md" && ext != "markdown" {
        return None;
    }
    let canonical: PathBuf = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Some(canonical.to_string_lossy().into_owned())
}

fn open_path(app: &AppHandle, path: &Path) {
    let Some(resolved) = resolve_markdown_path(path) else {
        return;
    };
    *app.state::<PendingOpen>().0.lock().unwrap() = Some(resolved.clone());
    let _ = app.emit("open-file", resolved);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

#[tauri::command]
fn take_pending_file(state: tauri::State<'_, PendingOpen>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if argv.len() > 1 {
                // argv comes from the second instance; resolve relative paths
                // against its working directory, not ours.
                let path = Path::new(&argv[1]);
                let abs = if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    Path::new(&cwd).join(path)
                };
                open_path(app, &abs);
            } else if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PendingOpen(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_markdown_file, take_pending_file])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                for path in paths {
                    if resolve_markdown_path(path).is_some() {
                        open_path(window.app_handle(), path);
                        break;
                    }
                }
            }
        })
        .setup(|_app| {
            #[cfg(not(target_os = "macos"))]
            {
                let args: Vec<String> = std::env::args().collect();
                if args.len() > 1 {
                    open_path(_app.handle(), Path::new(&args[1]));
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    open_path(_app_handle, &path);
                }
            }
        }
    });
}
