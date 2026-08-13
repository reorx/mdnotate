mod default_app;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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

/// A document spec waiting to be picked up by the frontend once it has mounted.
/// Cold-start opens (Finder double-click before the webview exists) land here;
/// warm opens are additionally delivered via the `open-doc` event.
///
/// The payload is whatever `doc-locator` on the frontend can read: an absolute
/// local path, an `mdnotate://` link, or the `host:path` a link carries.
struct PendingOpen(Mutex<Option<String>>);

/// The extensions worth opening. Must stay in step with `OPENABLE_EXTENSIONS`
/// in `src/lib/doc-locator.ts`, which is the tested copy of this rule; this one
/// exists because drag-drop has to pick a file out of a drop before the
/// frontend ever sees it.
const OPENABLE_EXTENSIONS: [&str; 15] = [
    "md", "markdown", "mdown", "mkd", "txt", "text", "log", "json", "yaml", "yml", "toml", "ini",
    "conf", "csv", "tsv",
];

fn resolve_openable_path(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    if !OPENABLE_EXTENSIONS.contains(&ext.as_str()) {
        return None;
    }
    let canonical: PathBuf = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Some(canonical.to_string_lossy().into_owned())
}

/// The one way a document reaches the frontend, whichever door it came in by.
/// Both delivery routes fire every time: the slot covers a webview that does
/// not exist yet, the event covers one that is already listening.
fn open_spec(app: &AppHandle, spec: String) {
    *app.state::<PendingOpen>().0.lock().unwrap() = Some(spec.clone());
    let _ = app.emit("open-doc", spec);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
    }
}

fn open_path(app: &AppHandle, path: &Path) {
    if let Some(resolved) = resolve_openable_path(path) {
        open_spec(app, resolved);
    }
}

/// A command-line argument or a forwarded argv: either a link, or a path to
/// resolve against the working directory it was typed in.
fn open_argument(app: &AppHandle, arg: &str, cwd: &Path) {
    // A scheme is case-insensitive, and a link typed by hand may not be lowercase.
    if arg.len() >= 11 && arg[..11].eq_ignore_ascii_case("mdnotate://") {
        open_spec(app, arg.to_string());
        return;
    }
    let path = Path::new(arg);
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    open_path(app, &abs);
}

/// A local file's text together with where it really lives.
#[derive(serde::Serialize)]
struct LocalFile {
    path: String,
    content: String,
}

/// Read a local file, answering with its canonical path as well as its text.
///
/// Identity follows the resolved path so that one document is one recents entry
/// however it was named: `/tmp/a.md` and `/private/tmp/a.md` are the same file,
/// and only the paths the OS hands us arrive canonical already.
#[tauri::command]
fn read_local_file(path: String) -> Result<LocalFile, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let canonical = Path::new(&path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&path));
    Ok(LocalFile {
        path: canonical.to_string_lossy().into_owned(),
        content,
    })
}

#[tauri::command]
fn take_pending_doc(state: tauri::State<'_, PendingOpen>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Absolute, because an app launched from Finder gets a bare `PATH`.
const SSH_BINARY: &str = "/usr/bin/ssh";
/// Long enough for a sleeping host to answer, short enough not to look hung.
const SSH_CONNECT_TIMEOUT: &str = "10";
const MAX_REMOTE_BYTES: u64 = 8 * 1024 * 1024;

/// Wrap a path for the remote shell. ssh joins its trailing arguments with
/// spaces and hands the result to a shell we do not control, so the path has to
/// arrive already quoted or every space in it becomes an argument break.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The most useful line of ssh's complaint, which is the last one it wrote.
fn last_line(stderr: &str) -> String {
    stderr
        .lines()
        .filter(|l| !l.trim().is_empty())
        .next_back()
        .unwrap_or("no output")
        .trim()
        .to_string()
}

/// Read a file from another machine over ssh.
///
/// Shelling out rather than speaking the protocol ourselves is the whole point:
/// it inherits `~/.ssh/config` entire — aliases, `Include`, `ProxyJump`, and an
/// existing `ControlMaster` socket, which turns this into a local-speed read
/// needing no authentication at all.
///
/// `BatchMode` keeps it from stopping on a prompt no one can see. It must run
/// off the main thread: a sync command would block the window for as long as
/// the connection takes.
#[tauri::command(async)]
fn read_remote_file(host: String, path: String) -> Result<String, String> {
    let mut child = Command::new(SSH_BINARY)
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg(format!("ConnectTimeout={SSH_CONNECT_TIMEOUT}"))
        .arg("--")
        .arg(&host)
        .arg("cat")
        .arg("--")
        .arg(shell_quote(&path))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run ssh: {e}"))?;

    // Read to a cap rather than to the end. Stopping short without killing the
    // child would leave `cat` blocked on a full pipe and the wait below hanging.
    let mut out = Vec::new();
    let mut stdout = child.stdout.take().expect("stdout was piped");
    let read = stdout.by_ref().take(MAX_REMOTE_BYTES + 1).read_to_end(&mut out);
    let too_large = out.len() as u64 > MAX_REMOTE_BYTES;
    if read.is_err() || too_large {
        let _ = child.kill();
        let _ = child.wait();
        return Err(match read {
            Err(e) => format!("Could not read {host}:{path} — {e}"),
            Ok(_) => format!(
                "{host}:{path} is larger than {} MB",
                MAX_REMOTE_BYTES / 1024 / 1024
            ),
        });
    }

    let status = child.wait().map_err(|e| format!("ssh failed: {e}"))?;
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut stderr);
    }

    if !status.success() {
        // 255 is ssh's own "could not connect"; anything else came back from
        // the remote `cat`, which already says what went wrong.
        return Err(if status.code() == Some(255) {
            format!(
                "Could not reach {host}: {}. If it needs a key, run `ssh {host}` in a terminal once.",
                last_line(&stderr)
            )
        } else {
            format!("Could not read {host}:{path} — {}", last_line(&stderr))
        });
    }

    String::from_utf8(out).map_err(|_| format!("{host}:{path} is not text"))
}

#[tauri::command]
fn markdown_default_app_status(app: AppHandle) -> DefaultAppStatus {
    default_app::status(&app.config().identifier)
}

#[tauri::command]
fn set_markdown_default_app(app: AppHandle) {
    default_app::request_default(&app.config().identifier);
}

// Window dragging for the toolbar. tauri's stock `start_dragging` reaches
// tao's drag_window through an async command plus an event-loop user message,
// by which point NSApp.currentEvent is a LeftMouseDragged — and macOS 26
// (Tahoe) makes performWindowDragWithEvent: a silent no-op for anything but a
// live LeftMouseDown (earlier releases tolerated the stale event, which is why
// drag regions used to work). This command must stay synchronous: sync
// commands run on the main thread while the mousedown is still being
// dispatched, so a LeftMouseDown synthesized here at the live cursor position
// is accepted. The frontend hook lives in `src/lib/window-drag.ts`.
#[cfg(target_os = "macos")]
#[tauri::command]
fn start_window_drag(window: tauri::Window) -> Result<(), String> {
    use objc2::encode::{Encode, Encoding};
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    unsafe impl Encode for CGPoint {
        const ENCODING: Encoding = Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }

    let ns_win = window.ns_window().map_err(|e| e.to_string())? as *mut AnyObject;
    unsafe {
        let screen_loc: CGPoint = msg_send![class!(NSEvent), mouseLocation];
        let local_loc: CGPoint = msg_send![ns_win, convertPointFromScreen: screen_loc];
        let win_number: isize = msg_send![ns_win, windowNumber];
        let proc_info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        let uptime: f64 = msg_send![proc_info, systemUptime];

        let event: *mut AnyObject = msg_send![
            class!(NSEvent),
            mouseEventWithType: 1usize, // NSEventTypeLeftMouseDown
            location: local_loc,
            modifierFlags: 0usize,
            timestamp: uptime,
            windowNumber: win_number,
            context: std::ptr::null_mut::<AnyObject>(),
            eventNumber: 0isize,
            clickCount: 1isize,
            pressure: 1.0f32,
        ];
        if event.is_null() {
            return Err("failed to synthesize drag event".into());
        }
        let _: () = msg_send![ns_win, performWindowDragWithEvent: event];
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if argv.len() > 1 {
                // argv comes from the second instance; resolve relative paths
                // against its working directory, not ours.
                open_argument(app, &argv[1], Path::new(&cwd));
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
            read_local_file,
            read_remote_file,
            take_pending_doc,
            markdown_default_app_status,
            set_markdown_default_app,
            start_window_drag
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                for path in paths {
                    if resolve_openable_path(path).is_some() {
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
                    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
                    open_argument(_app.handle(), &args[1], &cwd);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        // macOS delivers both a double-clicked file and a clicked mdnotate://
        // link through the same `application:openURLs:`. Anything that is not a
        // file goes to the frontend as it stands: the link grammar lives in
        // `doc-locator`, where it is tested, rather than being parsed twice.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                match url.to_file_path() {
                    Ok(path) => open_path(_app_handle, &path),
                    Err(_) => open_spec(_app_handle, url.as_str().to_string()),
                }
            }
        }
    });
}
