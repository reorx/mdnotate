//! Everything this command does to the world outside itself, behind one trait.
//!
//! `dispatch` decides; this carries out. Keeping the two apart is what lets the
//! whole behaviour table be a test: a fake standing in here records what was
//! asked of it, and nothing is opened, sent or written.

use std::io::{IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::quote::last_line;
use crate::{remote, session_discovery};

/// Absolute, all of them, for the reason `SSH_BINARY` is in `lib.rs`: an app
/// launched from Finder — and so a command run out of one — gets a bare `PATH`.
const OPEN: &str = "/usr/bin/open";
const DEFAULTS: &str = "/usr/bin/defaults";
const DATE: &str = "/bin/date";
const HOSTNAME: &str = "/bin/hostname";
const PS: &str = "/bin/ps";
const SSH: &str = "/usr/bin/ssh";

/// Long enough for a sleeping host to answer, short enough not to look hung.
/// The same number `read_remote_file` uses.
const SSH_CONNECT_TIMEOUT: &str = "10";

pub trait System {
    /// The `.app` this command was installed out of.
    fn app_bundle(&self) -> Result<PathBuf, String>;
    fn app_version(&self, app: &Path) -> Result<String, String>;
    fn open_files(&self, app: &Path, files: &[String]) -> Result<(), String>;
    fn open_link(&self, link: &str) -> Result<(), String>;
    fn focus_app(&self, app: &Path) -> Result<(), String>;
    fn stdin_is_tty(&self) -> bool;
    fn read_stdin(&self) -> Result<Vec<u8>, String>;
    fn read_file(&self, path: &Path) -> Result<Vec<u8>, String>;
    fn write_file(&self, path: &Path, bytes: &[u8]) -> Result<(), String>;
    fn cwd(&self) -> Result<PathBuf, String>;
    /// Not a number of seconds but the readable stamp that goes in a filename.
    fn timestamp(&self) -> String;
    fn pid(&self) -> u32;
    /// This machine's short hostname, as it will appear in a path over there.
    fn host_id(&self) -> String;
    fn push_and_launch(
        &self,
        host: &str,
        remote_dir: &str,
        remote_path: &str,
        content: &[u8],
    ) -> Result<(), String>;
    /// Transcripts worth looking in, best guess first.
    fn find_transcripts(&self, cwd: &Path) -> Vec<PathBuf>;
}

pub struct RealSystem;

impl System for RealSystem {
    /// Walk back through the symlink that was run and then up to the bundle.
    ///
    /// On macOS `current_exe` hands back the path the process was launched
    /// with, which through a `PATH` lookup is the link, not the file — so every
    /// hop has to be undone before any of the directories above mean anything.
    fn app_bundle(&self) -> Result<PathBuf, String> {
        let exe = std::env::current_exe()
            .map_err(|e| format!("could not work out my own path: {e}"))?;
        let exe = exe
            .canonicalize()
            .map_err(|e| format!("could not follow {} to a real file: {e}", exe.display()))?;
        let mut dir = exe.parent();
        while let Some(current) = dir {
            if current.extension().is_some_and(|ext| ext == "app") {
                return Ok(current.to_path_buf());
            }
            dir = current.parent();
        }
        Err(format!("{} is not inside a .app bundle", exe.display()))
    }

    /// Read off the bundle rather than written down here, so that it is the
    /// version of the app this command actually opens, and so that releasing a
    /// new one never has to remember this file.
    fn app_version(&self, app: &Path) -> Result<String, String> {
        let output = Command::new(DEFAULTS)
            .arg("read")
            .arg(app.join("Contents/Info"))
            .arg("CFBundleShortVersionString")
            .output()
            .map_err(|e| format!("could not run defaults: {e}"))?;
        if !output.status.success() {
            return Err(format!("could not read the version out of {}", app.display()));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// One call for every file, so that they arrive as one `openURLs:` and are
    /// routed together. `open` resolves a relative path against the directory
    /// it was run in, which is this one, so paths go over as they were typed.
    fn open_files(&self, app: &Path, files: &[String]) -> Result<(), String> {
        let mut command = Command::new(OPEN);
        command.arg("-a").arg(app).arg("--").args(files);
        run(command, "open")
    }

    fn open_link(&self, link: &str) -> Result<(), String> {
        let mut command = Command::new(OPEN);
        command.arg(link);
        run(command, "open")
    }

    fn focus_app(&self, app: &Path) -> Result<(), String> {
        let mut command = Command::new(OPEN);
        command.arg("-a").arg(app);
        run(command, "open")
    }

    fn stdin_is_tty(&self) -> bool {
        std::io::stdin().is_terminal()
    }

    fn read_stdin(&self) -> Result<Vec<u8>, String> {
        let mut buffer = Vec::new();
        std::io::stdin()
            .read_to_end(&mut buffer)
            .map_err(|e| format!("could not read the piped input: {e}"))?;
        Ok(buffer)
    }

    fn read_file(&self, path: &Path) -> Result<Vec<u8>, String> {
        std::fs::read(path).map_err(|e| format!("could not read {} — {e}", path.display()))
    }

    fn write_file(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not make {} — {e}", parent.display()))?;
        }
        std::fs::write(path, bytes).map_err(|e| format!("could not write {} — {e}", path.display()))
    }

    fn cwd(&self) -> Result<PathBuf, String> {
        std::env::current_dir().map_err(|e| format!("could not read the current directory: {e}"))
    }

    fn timestamp(&self) -> String {
        Command::new(DATE)
            .arg("+%Y%m%d-%H%M%S")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
            .filter(|stamp| !stamp.is_empty())
            // A filename still has to be made even if the clock will not say
            // what time it is; the pid beside it keeps runs apart.
            .unwrap_or_else(|| "undated".to_string())
    }

    fn pid(&self) -> u32 {
        std::process::id()
    }

    fn host_id(&self) -> String {
        Command::new(HOSTNAME)
            .arg("-s")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
            .unwrap_or_default()
    }

    /// Send the content and open it there, in one connection.
    ///
    /// Shelling out to ssh rather than speaking the protocol inherits
    /// `~/.ssh/config` entire — aliases, `Include`, `ProxyJump`, and an
    /// existing `ControlMaster` socket. `BatchMode` keeps it from stopping on a
    /// prompt nobody is watching for.
    fn push_and_launch(
        &self,
        host: &str,
        remote_dir: &str,
        remote_path: &str,
        content: &[u8],
    ) -> Result<(), String> {
        let mut child = Command::new(SSH)
            .arg("-o")
            .arg("BatchMode=yes")
            .arg("-o")
            .arg(format!("ConnectTimeout={SSH_CONNECT_TIMEOUT}"))
            .arg("--")
            .arg(host)
            .arg(remote::push_and_launch_command(remote_dir, remote_path))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not run ssh: {e}"))?;

        // Taken out and dropped at the end of this statement, which is what
        // closes the pipe — without that, `cat` never sees the end of its input
        // and the wait below never returns.
        child
            .stdin
            .take()
            .expect("stdin was piped")
            .write_all(content)
            .map_err(|e| format!("could not send {remote_path} to {host} — {e}"))?;

        let output = child
            .wait_with_output()
            .map_err(|e| format!("ssh failed: {e}"))?;
        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(match output.status.code() {
            // ssh's own "could not connect"; anything else came back from the
            // shell on the other side.
            Some(255) => format!(
                "could not reach {host}: {}. If it needs a key, run `ssh {host}` in a terminal once.",
                last_line(&stderr)
            ),
            // What a shell says when it cannot find the command. The remote
            // PATH is topped up with the two well-known directories, so this
            // means the command is installed somewhere else over there.
            Some(127) => format!(
                "{host} has no mdnotate command on its PATH — install it there, in /usr/local/bin or ~/.local/bin"
            ),
            _ => format!("could not send {remote_path} to {host} — {}", last_line(&stderr)),
        })
    }

    fn find_transcripts(&self, cwd: &Path) -> Vec<PathBuf> {
        // One snapshot for the whole walk, rather than one `ps` per hop.
        let table = Command::new(PS)
            .arg("-eo")
            .arg("pid=,ppid=")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| session_discovery::parse_process_table(&String::from_utf8_lossy(&output.stdout)))
            .unwrap_or_default();
        session_discovery::transcript_candidates(
            cwd,
            std::os::unix::process::parent_id(),
            &session_discovery::Dirs::from_env(),
            &|pid| table.get(&pid).copied().filter(|ppid| *ppid > 0),
        )
    }
}

/// Run a command that is only interesting for whether it worked.
fn run(mut command: Command, name: &str) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|e| format!("could not run {name}: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "{name} failed — {}",
        last_line(&String::from_utf8_lossy(&output.stderr))
    ))
}
