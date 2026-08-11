mod default_app;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

use default_app::DefaultAppStatus;

/// Recently opened documents. Files are remembered by path; clipboard entries
/// keep their full text in `body`, since there is nothing to re-read them from.
/// Must match the URL the frontend passes to `Database.load`.
const DB_URL: &str = "sqlite:mdnotate.db";

fn migrations() -> Vec<Migration> {
    vec![
        // sqlx checksums each migration's SQL and refuses to open a database
        // whose applied migrations no longer match. The text below is therefore
        // frozen, indentation included — reformat it and every existing install
        // fails to open its database.
        Migration {
            version: 1,
            description: "create_recent_docs",
            sql: "CREATE TABLE recent_docs (
                  id         TEXT PRIMARY KEY,
                  kind       TEXT NOT NULL,
                  title      TEXT NOT NULL,
                  source     TEXT NOT NULL,
                  body       TEXT,
                  snippet    TEXT NOT NULL,
                  char_count INTEGER NOT NULL,
                  opened_at  INTEGER NOT NULL
              );
              CREATE INDEX idx_recent_docs_opened_at ON recent_docs (opened_at DESC);",
            kind: MigrationKind::Up,
        },
        // Highlights and comments, restored when the document is opened again.
        // `doc_hash` is the hash of the content the offsets were measured
        // against: annotations carrying any other hash were made on text that
        // has since changed, and are dropped rather than misplaced.
        // A document leaving the recents list takes its annotations with it —
        // sqlx enables `PRAGMA foreign_keys`, so the cascade really fires.
        // `start`/`end` are avoided as column names: END is an SQL keyword.
        Migration {
            version: 2,
            description: "create_annotations",
            sql: "CREATE TABLE annotations (
                      id           TEXT PRIMARY KEY,
                      doc_id       TEXT NOT NULL REFERENCES recent_docs(id) ON DELETE CASCADE,
                      doc_hash     TEXT NOT NULL,
                      quote        TEXT NOT NULL,
                      start_offset INTEGER NOT NULL,
                      end_offset   INTEGER NOT NULL,
                      comment      TEXT,
                      created_at   INTEGER NOT NULL,
                      updated_at   INTEGER NOT NULL
                  );
                  CREATE INDEX idx_annotations_doc_id ON annotations (doc_id);",
            kind: MigrationKind::Up,
        },
    ]
}

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

#[tauri::command]
fn markdown_default_app_status(app: AppHandle) -> DefaultAppStatus {
    default_app::status(&app.config().identifier)
}

#[tauri::command]
fn set_markdown_default_app(app: AppHandle) {
    default_app::request_default(&app.config().identifier);
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
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .manage(PendingOpen(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            read_markdown_file,
            take_pending_file,
            markdown_default_app_status,
            set_markdown_default_app
        ])
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
