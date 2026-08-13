mod default_app;

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder};
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

/// What the router knows about every window there is.
///
/// One lock covers all of it deliberately. A document reaches a window either
/// as an event or by being left in the slot the window empties on startup, and
/// choosing between the two has to be atomic against the window announcing that
/// it has started. Split across two locks, a window that starts up in the middle
/// of that choice could have a document left in a slot it has already emptied.
struct Windows(Mutex<HashMap<String, WindowEntry>>);

#[derive(Default)]
struct WindowEntry {
    /// The document this window holds. Set as soon as one is routed here when
    /// it can be worked out from the spec — a link or a remote path cannot be,
    /// before it has been read — and corrected by the window itself once it
    /// knows what it actually opened.
    doc_id: Option<String>,
    /// Whether a document has been routed here at all. A window is spoken for
    /// from that moment, even while what it is reading has no id yet.
    taken: bool,
    /// Whether the webview has started and is listening for `open-doc`. Until
    /// it has, `pending` is the only way to reach it.
    ready: bool,
    /// A document waiting for a webview that is still starting up. The payload
    /// is whatever `doc-locator` on the frontend can read: an absolute local
    /// path, an `mdnotate://` link, or the `host:path` a link carries.
    pending: Option<String>,
}

/// Labels for the windows opened after the first. `main` comes from the config
/// and these count on from it, never reused, so one label never names two
/// windows over the life of the app.
struct NextLabel(AtomicUsize);

/// A document with as much known about it as the door it came in by could tell.
struct Incoming {
    spec: String,
    doc_id: Option<String>,
}

/// Documents that arrived before there was anywhere to put them.
///
/// An app launched by double-clicking a document is handed it before the event
/// loop reports itself ready — and the window in the config is not created
/// until it does, in Tauri's own `setup`. Routed on arrival, that document
/// would find no windows at all and open one of its own, with the configured
/// window turning up empty behind it. So it waits here until there is one.
///
/// `Some` while the app is still starting: the buffer, and the fact that it is
/// still needed, are the same thing.
struct ColdStart(Mutex<Option<Vec<Incoming>>>);

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

/// How the frontend will know a local file, so that one already open can be
/// recognised before it is read again. Mirrors `fileDocId` in
/// `src/lib/recent-docs.ts`; the ids of links and remote paths cannot be worked
/// out here, because that grammar lives in `doc-locator` alone.
fn file_doc_id(path: &str) -> String {
    format!("file:{path}")
}

/// Where an incoming document should go.
#[derive(Debug, PartialEq, Eq)]
enum Target {
    /// This window: the one already showing the document — where opening it
    /// again reads it afresh, so a second double-click is a refresh — or one
    /// still on the home screen, or the one a file was dropped on.
    Deliver(String),
    /// Every window is spoken for.
    Spawn,
}

/// One window, as the routing rule sees it.
#[derive(Debug, PartialEq, Eq)]
struct WindowState {
    label: String,
    /// The document it holds, where that is known.
    doc_id: Option<String>,
    /// Whether it holds a document at all, identified or not.
    occupied: bool,
}

/// Pick the window a document belongs in. `windows` comes frontmost first, so
/// that "the empty one" means the one the user is looking at when more than one
/// is empty.
///
/// `dropped_on` is the window a file was dragged onto: what is dropped on a
/// window opens there, whatever it was showing. Being already open wins even
/// over that — one document, one window, is the rule the annotations depend on,
/// since two windows on one document would write to the same rows while showing
/// each other nothing.
fn choose_target(windows: &[WindowState], doc_id: Option<&str>, dropped_on: Option<&str>) -> Target {
    if let Some(id) = doc_id {
        if let Some(window) = windows.iter().find(|w| w.doc_id.as_deref() == Some(id)) {
            return Target::Deliver(window.label.clone());
        }
    }
    if let Some(label) = dropped_on {
        return Target::Deliver(label.to_string());
    }
    match windows.iter().find(|w| !w.occupied) {
        Some(window) => Target::Deliver(window.label.clone()),
        None => Target::Spawn,
    }
}

/// Every window, frontmost first.
fn window_states(app: &AppHandle) -> Vec<WindowState> {
    // The windows themselves are asked who has focus before the lock is taken:
    // nothing that has to reach the event loop belongs inside it.
    let mut order: Vec<(String, bool)> = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| (label, window.is_focused().unwrap_or(false)))
        .collect();
    // `webview_windows` answers with a map, so without an order of our own the
    // window an unfocused app opens into would be whichever one hashed first.
    order.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| label_order(&b.0).cmp(&label_order(&a.0)))
    });

    let state = app.state::<Windows>();
    let windows = state.0.lock().unwrap();
    order
        .into_iter()
        .map(|(label, _)| {
            let entry = windows.get(&label);
            WindowState {
                doc_id: entry.and_then(|e| e.doc_id.clone()),
                occupied: entry.is_some_and(|e| e.taken),
                label,
            }
        })
        .collect()
}

/// The one way a document reaches a window, whichever door it came in by.
///
/// `doc_id` is how the frontend will come to know the document, where that can
/// be told from the spec alone. Without it the document cannot be recognised as
/// already open, and gets a window of its own.
fn open_spec(app: &AppHandle, spec: String, doc_id: Option<String>, dropped_on: Option<&str>) {
    // Nothing can be routed before the app has the window its config asks for.
    if let Some(waiting) = app.state::<ColdStart>().0.lock().unwrap().as_mut() {
        waiting.push(Incoming { spec, doc_id });
        return;
    }
    match choose_target(&window_states(app), doc_id.as_deref(), dropped_on) {
        Target::Deliver(label) => {
            deliver(app, &label, spec, doc_id);
            raise(app, &label);
        }
        Target::Spawn => {
            if let Err(e) = spawn_window(app, spec, doc_id) {
                eprintln!("mdnotate: could not open a window: {e}");
            }
        }
    }
}

/// Hand a document to a window that already exists. One whose webview is still
/// starting up cannot be listening yet, so it finds the document in its slot
/// instead — which is how a cold-start double-click arrives.
fn deliver(app: &AppHandle, label: &str, spec: String, doc_id: Option<String>) {
    let state = app.state::<Windows>();
    let mut windows = state.0.lock().unwrap();
    let entry = windows.entry(label.to_string()).or_default();
    entry.doc_id = doc_id;
    entry.taken = true;
    if !entry.ready {
        entry.pending = Some(spec);
        return;
    }
    drop(windows);
    let _ = app.emit_to(label, "open-doc", spec);
}

/// Open another window on the document.
fn spawn_window(app: &AppHandle, spec: String, doc_id: Option<String>) -> tauri::Result<()> {
    let label = format!(
        "doc-{}",
        app.state::<NextLabel>().0.fetch_add(1, Ordering::Relaxed)
    );
    // The entry has to exist before the window does: the webview starts up on
    // its own schedule and asks for its document the moment it can.
    app.state::<Windows>().0.lock().unwrap().insert(
        label.clone(),
        WindowEntry {
            doc_id,
            taken: true,
            ready: false,
            pending: Some(spec),
        },
    );

    // Cloned from the window in the config, so that a second window is the
    // first one in every respect that was configured — overlay title bar,
    // traffic light position, minimum size.
    let mut config = window_config(app);
    config.label = label.clone();
    let built = WebviewWindowBuilder::from_config(app, &config).and_then(|builder| {
        match cascade_origin(app) {
            Some((x, y)) => builder.position(x, y),
            None => builder,
        }
        .build()
    });
    if built.is_err() {
        app.state::<Windows>().0.lock().unwrap().remove(&label);
    }
    built.map(|_| ())
}

fn window_config(app: &AppHandle) -> WindowConfig {
    app.config()
        .app
        .windows
        .first()
        .cloned()
        .unwrap_or_default()
}

/// How far a new window is laid down and to the right of the one in front, so
/// that it does not land exactly on top of it and look like nothing happened.
const CASCADE_STEP: f64 = 28.0;

/// Where to put a new window: stepped off the one in front, and back to the top
/// left of the screen before the step would walk it off the bottom right.
fn cascade_origin(app: &AppHandle) -> Option<(f64, f64)> {
    let front = front_window(app)?;
    let scale = front.scale_factor().ok()?;
    let origin = front.outer_position().ok()?.to_logical::<f64>(scale);
    let size = front.outer_size().ok()?.to_logical::<f64>(scale);
    let stepped = (origin.x + CASCADE_STEP, origin.y + CASCADE_STEP);

    let Some(monitor) = front.current_monitor().ok().flatten() else {
        return Some(stepped);
    };
    let area = monitor.work_area();
    let corner = area.position.to_logical::<f64>(monitor.scale_factor());
    let extent = area.size.to_logical::<f64>(monitor.scale_factor());
    let fits = stepped.0 + size.width <= corner.x + extent.width
        && stepped.1 + size.height <= corner.y + extent.height;
    Some(if fits {
        stepped
    } else {
        (corner.x + CASCADE_STEP, corner.y + CASCADE_STEP)
    })
}

/// How recently a window was opened, read off its label: `main` came first and
/// the `doc-N` labels count on from there. It stands in for the front-to-back
/// order while the app is in the background and nothing is focused at all —
/// which is precisely when a document arrives from somewhere else.
fn label_order(label: &str) -> usize {
    label
        .strip_prefix("doc-")
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

/// The window the user is looking at: the focused one, or failing that the one
/// opened most recently — never an arbitrary one, or a new window would be laid
/// on top of a window it was not stepped off.
fn front_window(app: &AppHandle) -> Option<WebviewWindow> {
    let mut windows: Vec<(String, WebviewWindow)> = app.webview_windows().into_iter().collect();
    windows.sort_by_key(|(label, _)| std::cmp::Reverse(label_order(label)));
    windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .or_else(|| windows.first())
        .map(|(_, window)| window.clone())
}

fn raise(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn open_path(app: &AppHandle, path: &Path, dropped_on: Option<&str>) {
    if let Some(resolved) = resolve_openable_path(path) {
        let doc_id = file_doc_id(&resolved);
        open_spec(app, resolved, Some(doc_id), dropped_on);
    }
}

/// A command-line argument or a forwarded argv: either a link, or a path to
/// resolve against the working directory it was typed in.
fn open_argument(app: &AppHandle, arg: &str, cwd: &Path) {
    // A scheme is case-insensitive, and a link typed by hand may not be lowercase.
    if arg.len() >= 11 && arg[..11].eq_ignore_ascii_case("mdnotate://") {
        open_spec(app, arg.to_string(), None, None);
        return;
    }
    let path = Path::new(arg);
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    open_path(app, &abs, None);
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

/// A window collecting the document it was opened for, if it was opened for
/// one. Asking is also how a window says it is listening: everything routed
/// after this call arrives as an event instead of being left in the slot.
#[tauri::command]
fn take_pending_doc(window: tauri::Window, state: tauri::State<'_, Windows>) -> Option<String> {
    let mut windows = state.0.lock().unwrap();
    let entry = windows.entry(window.label().to_string()).or_default();
    entry.ready = true;
    entry.pending.take()
}

/// A window saying which document it now holds, or `None` when an attempt to
/// open one came to nothing. Routing the next document depends on it: a window
/// already showing that document is raised instead of opening a second copy,
/// and a window still on the home screen is filled rather than pushed aside.
#[tauri::command]
fn set_window_doc(window: tauri::Window, doc_id: Option<String>, state: tauri::State<'_, Windows>) {
    let mut windows = state.0.lock().unwrap();
    let entry = windows.entry(window.label().to_string()).or_default();
    entry.taken = doc_id.is_some();
    entry.doc_id = doc_id;
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

#[cfg(test)]
mod tests {
    use super::{choose_target, Target, WindowState};

    fn window(label: &str, doc_id: Option<&str>) -> WindowState {
        WindowState {
            label: label.to_string(),
            doc_id: doc_id.map(str::to_string),
            occupied: doc_id.is_some(),
        }
    }

    /// A window still on the home screen, which is what a cold start leaves
    /// behind: filling it is what keeps a double-clicked file from arriving
    /// next to an empty window rather than in it.
    #[test]
    fn an_empty_window_takes_the_document() {
        let windows = [window("main", None)];
        assert_eq!(
            choose_target(&windows, Some("file:/a.md"), None),
            Target::Deliver("main".into())
        );
    }

    #[test]
    fn the_frontmost_empty_window_takes_it() {
        let windows = [window("doc-2", None), window("main", None)];
        assert_eq!(
            choose_target(&windows, Some("file:/a.md"), None),
            Target::Deliver("doc-2".into())
        );
    }

    /// Opening it again is how a document is refreshed, so it goes back to the
    /// window that has it rather than to a second one.
    #[test]
    fn a_document_already_open_goes_back_to_its_own_window() {
        let windows = [window("main", Some("file:/a.md")), window("doc-1", Some("file:/b.md"))];
        assert_eq!(
            choose_target(&windows, Some("file:/b.md"), None),
            Target::Deliver("doc-1".into())
        );
    }

    #[test]
    fn a_window_reading_something_else_is_left_alone() {
        let windows = [window("main", Some("file:/a.md"))];
        assert_eq!(choose_target(&windows, Some("file:/b.md"), None), Target::Spawn);
    }

    #[test]
    fn no_windows_at_all_means_a_new_one() {
        assert_eq!(choose_target(&[], Some("file:/a.md"), None), Target::Spawn);
    }

    /// A link and a remote path have no id until they have been read, so they
    /// cannot be recognised as already open — but they must still not land on
    /// top of someone's document.
    #[test]
    fn an_unrecognisable_document_still_gets_its_own_window() {
        let windows = [window("main", Some("file:/a.md"))];
        assert_eq!(choose_target(&windows, None, None), Target::Spawn);
    }

    #[test]
    fn an_unrecognisable_document_takes_an_empty_window() {
        let windows = [window("main", None)];
        assert_eq!(choose_target(&windows, None, None), Target::Deliver("main".into()));
    }

    /// Until its window has read it, a document on its way has no id — but the
    /// window is spoken for all the same, or the next one would land on it.
    #[test]
    fn a_window_with_a_document_on_the_way_is_not_empty() {
        let windows = [WindowState {
            label: "doc-1".into(),
            doc_id: None,
            occupied: true,
        }];
        assert_eq!(choose_target(&windows, Some("file:/a.md"), None), Target::Spawn);
    }

    #[test]
    fn a_drop_opens_in_the_window_it_landed_on() {
        let windows = [window("main", Some("file:/a.md")), window("doc-1", None)];
        assert_eq!(
            choose_target(&windows, Some("file:/b.md"), Some("main")),
            Target::Deliver("main".into())
        );
    }

    /// Being already open wins over everything, the window it was dropped on
    /// included: two windows on one document would write annotations to the
    /// same rows while showing each other nothing.
    #[test]
    fn a_drop_goes_to_the_window_that_already_has_it() {
        let windows = [window("main", None), window("doc-1", Some("file:/b.md"))];
        assert_eq!(
            choose_target(&windows, Some("file:/b.md"), Some("main")),
            Target::Deliver("doc-1".into())
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if argv.len() > 1 {
                // argv comes from the second instance; resolve relative paths
                // against its working directory, not ours.
                open_argument(app, &argv[1], Path::new(&cwd));
            } else if let Some(window) = front_window(app) {
                let _ = window.set_focus();
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
        .manage(Windows(Mutex::new(HashMap::new())))
        .manage(NextLabel(AtomicUsize::new(1)))
        .manage(ColdStart(Mutex::new(Some(Vec::new()))))
        .invoke_handler(tauri::generate_handler![
            read_local_file,
            read_remote_file,
            take_pending_doc,
            set_window_doc,
            markdown_default_app_status,
            set_markdown_default_app,
            start_window_drag
        ])
        .on_window_event(|window, event| match event {
            // Dropped on a window is opened in that window, whatever it was
            // showing — unless it turns out to be open elsewhere already.
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                for path in paths {
                    if resolve_openable_path(path).is_some() {
                        open_path(window.app_handle(), path, Some(window.label()));
                        break;
                    }
                }
            }
            // Nothing is left of a closed window but its entry, which would
            // otherwise go on claiming a document nobody is reading.
            tauri::WindowEvent::Destroyed => {
                let state = window.state::<Windows>();
                let mut windows = state.0.lock().unwrap();
                windows.remove(window.label());
            }
            _ => {}
        })
        .setup(|app| {
            #[cfg(not(target_os = "macos"))]
            {
                let args: Vec<String> = std::env::args().collect();
                if args.len() > 1 {
                    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
                    open_argument(app.handle(), &args[1], &cwd);
                }
            }
            // The configured window exists by now: Tauri's own setup builds it
            // just before calling this. Whatever the app was launched to open
            // can finally be routed — into that window, if it is the only one.
            let waiting = app.state::<ColdStart>().0.lock().unwrap().take();
            for doc in waiting.unwrap_or_default() {
                open_spec(app.handle(), doc.spec, doc.doc_id, None);
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
                    Ok(path) => open_path(_app_handle, &path, None),
                    Err(_) => open_spec(_app_handle, url.as_str().to_string(), None, None),
                }
            }
        }
    });
}
