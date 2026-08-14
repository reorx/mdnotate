//! The `mdnotate` command: putting it on the PATH, checking whether it is
//! there, and taking it off again.
//!
//! What gets installed is a symlink to the shell script bundled at
//! `Contents/Resources/bin/mdnotate` — never a copy, so that the command a
//! user installed once keeps working across every update, and so that removing
//! it is removing one link. The script's own comments cover what it does when
//! run; nothing here ever runs it.
//!
//! macOS only, and unlike `default_app` there is no stub for anywhere else: a
//! symlink into a `.app` bundle, and an administrator prompt raised by
//! AppleScript, are not things that mean anything on another platform.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::{last_line, shell_quote};

/// Absolute for the same reason `SSH_BINARY` is: an app launched from Finder
/// has almost nothing on its `PATH`.
const OSASCRIPT_BINARY: &str = "/usr/bin/osascript";

/// The name the command goes by, which is also the name of the bundled script.
const COMMAND_NAME: &str = "mdnotate";

/// What is sitting at a candidate path, as far as installing over it goes.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum LinkState {
    /// Nothing there at all.
    Missing,
    /// A symlink to this very app's script — the command is installed here.
    Ours,
    /// A symlink to nothing: the app it pointed at has been deleted or moved.
    Dangling,
    /// A symlink that resolves, but somewhere else — another copy of mdnotate,
    /// or something unrelated that happens to share the name.
    Foreign,
    /// A real file, not a symlink at all. Someone else's, until proven
    /// otherwise, and never overwritten.
    Occupied,
}

/// One place the command might be, and what is there now.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallEntry {
    pub dir: String,
    /// `dir` with the command name on the end, which is what a link would be.
    pub path: String,
    pub state: LinkState,
}

/// Where the app is running from, which decides whether a link to it is worth
/// making at all.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum AppLocation {
    /// Inside a `.app` that is staying put.
    Bundled,
    /// Not in a bundle: a `tauri dev` build, which has no script to link to.
    Unbundled,
    /// On a mounted volume — a disk image, most likely, straight out of the
    /// downloaded dmg. The link would outlive the volume by a few minutes.
    Removable,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallStatus {
    pub supported: bool,
    pub app_location: AppLocation,
    pub entries: Vec<CliInstallEntry>,
}

/// Where the bundled script sits, given the app's resource directory.
pub fn script_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join("bin").join(COMMAND_NAME)
}

/// The two directories offered without the user having to type one.
/// `/usr/local/bin` is where a command is conventionally put and is on almost
/// every `PATH` already, at the cost of belonging to root; `~/.local/bin` needs
/// no permission but is only on the `PATH` of someone who put it there.
pub fn well_known_dirs(home: &Path) -> Vec<PathBuf> {
    vec![PathBuf::from("/usr/local/bin"), home.join(".local/bin")]
}

/// Where the app is, judged by the script it would be linking to. Told apart
/// from a missing bundle rather than assumed: `tauri dev` runs a bare binary
/// with no `Contents/Resources` at all, and it is the one case where the card
/// has nothing to offer rather than something to warn about.
pub fn app_location(script: &Path) -> AppLocation {
    if !script.is_file() {
        return AppLocation::Unbundled;
    }
    // Every mounted volume other than the startup disk lives under /Volumes,
    // and a dmg is the one people actually run an app from by accident.
    match script.canonicalize() {
        Ok(resolved) if resolved.starts_with("/Volumes/") => AppLocation::Removable,
        _ => AppLocation::Bundled,
    }
}

pub fn status(dirs: &[PathBuf], script: &Path) -> CliInstallStatus {
    CliInstallStatus {
        supported: true,
        app_location: app_location(script),
        entries: dirs.iter().map(|dir| entry(dir, script)).collect(),
    }
}

fn entry(dir: &Path, script: &Path) -> CliInstallEntry {
    let link = dir.join(COMMAND_NAME);
    CliInstallEntry {
        state: classify(&link, script),
        dir: dir.to_string_lossy().into_owned(),
        path: link.to_string_lossy().into_owned(),
    }
}

/// What is at `link`, told without following it blindly: `symlink_metadata`
/// answers about the link itself, so that a link to nothing is distinguished
/// from nothing at all — they look identical to anything that follows links,
/// and they need different things done to them.
fn classify(link: &Path, script: &Path) -> LinkState {
    let Ok(meta) = std::fs::symlink_metadata(link) else {
        return LinkState::Missing;
    };
    if !meta.file_type().is_symlink() {
        return LinkState::Occupied;
    }
    let Ok(resolved) = link.canonicalize() else {
        return LinkState::Dangling;
    };
    // Both sides canonicalized, because `script` is only where we expect the
    // script to be, and the path it was built from need not be resolved yet.
    // With no script to compare against — a dev build — every link is somebody
    // else's, which is the honest answer rather than a hopeful one.
    match script.canonicalize() {
        Ok(ours) if ours == resolved => LinkState::Ours,
        _ => LinkState::Foreign,
    }
}

/// Point `dir/mdnotate` at our own script, replacing a link already there.
///
/// Replacing is the whole of the repair story: a link left behind by a copy of
/// the app that has been deleted, or one pointing at a different copy, is fixed
/// by installing over it, which is why there is no separate action for it. A
/// real file is refused instead — there is no telling one somebody else put
/// there from one we did, and deleting the first kind to save the user an error
/// message is a bad trade.
///
/// Escalation is not decided in advance but fallen back on: the link is
/// attempted outright, and only permission being refused sends it through the
/// prompt. Deciding beforehand means deciding on a directory whose permissions
/// were read at some earlier moment, and being wrong in the direction of asking
/// for a password that was not needed.
pub fn install(dir: &Path, script: &Path) -> Result<(), String> {
    let link = dir.join(COMMAND_NAME);
    if let Ok(meta) = std::fs::symlink_metadata(&link) {
        if !meta.file_type().is_symlink() {
            return Err(format!(
                "{} already exists and is not something mdnotate put there — remove it first",
                link.display()
            ));
        }
    }
    match link_directly(dir, &link, script) {
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => escalated(&format!(
            "/bin/mkdir -p {} && /bin/ln -sfn {} {}",
            shell_quote(&dir.to_string_lossy()),
            shell_quote(&script.to_string_lossy()),
            shell_quote(&link.to_string_lossy()),
        )),
        Err(e) => Err(format!("Failed to install {}: {e}", link.display())),
        Ok(()) => Ok(()),
    }
}

/// Build the link beside where it is going and move it into place, because
/// `symlink` will not overwrite anything: replacing one any other way means a
/// moment where the command points at neither the old script nor the new one.
fn link_directly(dir: &Path, link: &Path, script: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let staged = dir.join(format!(".mdnotate-install-{}", std::process::id()));
    // Nothing is left behind on the way out: a staged link that cannot be moved
    // into place would sit in someone's bin directory forever.
    let result = std::os::unix::fs::symlink(script, &staged).and_then(|_| std::fs::rename(&staged, link));
    if result.is_err() {
        let _ = std::fs::remove_file(&staged);
    }
    result
}

/// Take the command off the PATH again.
///
/// What is there is classified once more rather than taken on the card's word:
/// between drawing that card and clicking it, the link may have become somebody
/// else's, and removing a file we did not put there is not ours to do.
pub fn uninstall(dir: &Path, script: &Path) -> Result<(), String> {
    let link = dir.join(COMMAND_NAME);
    match classify(&link, script) {
        LinkState::Missing => Ok(()),
        LinkState::Ours | LinkState::Dangling => match std::fs::remove_file(&link) {
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                escalated(&format!("/bin/rm -f {}", shell_quote(&link.to_string_lossy())))
            }
            Err(e) => Err(format!("Failed to remove {}: {e}", link.display())),
            Ok(()) => Ok(()),
        },
        LinkState::Foreign | LinkState::Occupied => Err(format!(
            "{} is not mdnotate's own link — leaving it alone",
            link.display()
        )),
    }
}

/// Run one shell command as an administrator, through the prompt macOS puts up
/// for it. Blocks for as long as that prompt is on screen, which is why both
/// commands that reach this are async.
fn escalated(shell_command: &str) -> Result<(), String> {
    let source = format!(
        "do shell script {} with administrator privileges",
        applescript_quote(shell_command)
    );
    let output = Command::new(OSASCRIPT_BINARY)
        .arg("-e")
        .arg(&source)
        .output()
        .map_err(|e| format!("Could not run osascript: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    // -128 is AppleScript's own "user cancelled", which is what dismissing the
    // password prompt raises. It is an answer, not a failure, and deserves
    // plainer words than the error it arrives wrapped in.
    if stderr.contains("-128") {
        return Err("Cancelled — administrator approval was not given".to_string());
    }
    Err(format!("Could not get permission — {}", last_line(&stderr)))
}

/// Wrap a string as one double-quoted AppleScript literal. A layer under
/// `shell_quote` rather than a replacement for it: what goes in here is already
/// quoted for the shell that AppleScript will hand it to, and the backslash
/// `shell_quote` writes for an embedded single quote is exactly the character
/// AppleScript would otherwise read as an escape of its own.
fn applescript_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A directory of its own for each test, since they run at the same time.
    fn scratch() -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "mdnotate-cli-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Stands in for the script inside the bundle.
    fn script_in(dir: &Path) -> PathBuf {
        let script = dir.join("app/Contents/Resources/bin/mdnotate");
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::write(&script, "#!/bin/sh\n").unwrap();
        script
    }

    #[test]
    fn a_directory_without_the_command_reports_nothing_there() {
        let dir = scratch();
        assert_eq!(classify(&dir.join("mdnotate"), &script_in(&dir)), LinkState::Missing);
    }

    #[test]
    fn a_link_to_our_own_script_is_the_command_installed() {
        let dir = scratch();
        let script = script_in(&dir);
        std::os::unix::fs::symlink(&script, dir.join("mdnotate")).unwrap();
        assert_eq!(classify(&dir.join("mdnotate"), &script), LinkState::Ours);
    }

    /// What an uninstalled or moved copy of the app leaves behind. Told apart
    /// from `Missing` because the two need different things done to them, and
    /// anything that follows the link sees them as the same.
    #[test]
    fn a_link_whose_app_is_gone_is_dangling_not_missing() {
        let dir = scratch();
        std::os::unix::fs::symlink(dir.join("nowhere"), dir.join("mdnotate")).unwrap();
        assert_eq!(classify(&dir.join("mdnotate"), &script_in(&dir)), LinkState::Dangling);
    }

    #[test]
    fn a_link_to_another_copy_of_the_app_is_foreign() {
        let dir = scratch();
        let other = dir.join("other-mdnotate");
        std::fs::write(&other, "#!/bin/sh\n").unwrap();
        std::os::unix::fs::symlink(&other, dir.join("mdnotate")).unwrap();
        assert_eq!(classify(&dir.join("mdnotate"), &script_in(&dir)), LinkState::Foreign);
    }

    #[test]
    fn a_real_file_of_the_same_name_is_somebody_elses() {
        let dir = scratch();
        std::fs::write(dir.join("mdnotate"), "not a link").unwrap();
        assert_eq!(classify(&dir.join("mdnotate"), &script_in(&dir)), LinkState::Occupied);
    }

    /// A directory belonging to root falls through to the administrator prompt
    /// rather than failing, which is the one branch of `install` no test can
    /// reach: the prompt needs someone to answer it.
    #[test]
    fn installing_where_we_have_no_permission_does_not_fail_outright() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch();
        let script = script_in(&dir);
        let locked = dir.join("locked");
        std::fs::create_dir(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();
        let refused = link_directly(&locked, &locked.join("mdnotate"), &script)
            .map_err(|e| e.kind() == std::io::ErrorKind::PermissionDenied);
        // Put back before asserting, so that a failure still leaves a directory
        // the temporary sweep is able to remove.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(refused, Err(true));
    }

    #[test]
    fn installing_makes_the_directory_it_needs() {
        let dir = scratch();
        let script = script_in(&dir);
        let bin = dir.join("nested/bin");
        install(&bin, &script).unwrap();
        assert_eq!(classify(&bin.join("mdnotate"), &script), LinkState::Ours);
    }

    /// The reason there is no separate repair action: installing is the repair.
    #[test]
    fn installing_over_a_link_whose_app_is_gone_repoints_it() {
        let dir = scratch();
        let script = script_in(&dir);
        std::os::unix::fs::symlink(dir.join("nowhere"), dir.join("mdnotate")).unwrap();
        install(&dir, &script).unwrap();
        assert_eq!(classify(&dir.join("mdnotate"), &script), LinkState::Ours);
    }

    #[test]
    fn installing_over_a_link_to_another_copy_repoints_it_too() {
        let dir = scratch();
        let script = script_in(&dir);
        let other = dir.join("other-mdnotate");
        std::fs::write(&other, "#!/bin/sh\n").unwrap();
        std::os::unix::fs::symlink(&other, dir.join("mdnotate")).unwrap();
        install(&dir, &script).unwrap();
        assert_eq!(classify(&dir.join("mdnotate"), &script), LinkState::Ours);
    }

    #[test]
    fn installing_over_somebody_elses_file_is_refused_and_leaves_it_alone() {
        let dir = scratch();
        let script = script_in(&dir);
        std::fs::write(dir.join("mdnotate"), "not ours").unwrap();
        assert!(install(&dir, &script).is_err());
        assert_eq!(std::fs::read_to_string(dir.join("mdnotate")).unwrap(), "not ours");
    }

    #[test]
    fn uninstalling_what_is_not_there_is_not_an_error() {
        let dir = scratch();
        assert!(uninstall(&dir, &script_in(&dir)).is_ok());
    }

    #[test]
    fn uninstalling_takes_our_own_link_away() {
        let dir = scratch();
        let script = script_in(&dir);
        install(&dir, &script).unwrap();
        uninstall(&dir, &script).unwrap();
        assert_eq!(classify(&dir.join("mdnotate"), &script), LinkState::Missing);
    }

    /// A link left behind by a copy of the app that is gone is still ours to
    /// clear away — there is nothing else it could have been.
    #[test]
    fn uninstalling_clears_away_a_link_whose_app_is_gone() {
        let dir = scratch();
        let script = script_in(&dir);
        std::os::unix::fs::symlink(dir.join("nowhere"), dir.join("mdnotate")).unwrap();
        uninstall(&dir, &script).unwrap();
        assert_eq!(classify(&dir.join("mdnotate"), &script), LinkState::Missing);
    }

    #[test]
    fn uninstalling_refuses_a_link_that_is_not_ours() {
        let dir = scratch();
        let script = script_in(&dir);
        let other = dir.join("other-mdnotate");
        std::fs::write(&other, "#!/bin/sh\n").unwrap();
        std::os::unix::fs::symlink(&other, dir.join("mdnotate")).unwrap();
        assert!(uninstall(&dir, &script).is_err());
        assert!(dir.join("mdnotate").exists());
    }

    #[test]
    fn a_build_with_no_bundle_around_it_has_nothing_to_link_to() {
        let dir = scratch();
        assert_eq!(app_location(&dir.join("no-such-script")), AppLocation::Unbundled);
    }

    #[test]
    fn a_script_that_is_really_there_can_be_linked_to() {
        let dir = scratch();
        assert_eq!(app_location(&script_in(&dir)), AppLocation::Bundled);
    }

    #[test]
    fn the_shared_directory_is_offered_before_the_private_one() {
        assert_eq!(
            well_known_dirs(Path::new("/Users/example")),
            vec![
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/Users/example/.local/bin")
            ]
        );
    }

    /// The names the frontend matches on, which are spelled out a second time
    /// in `src/lib/cli-install.ts` and only agree with these by hand.
    #[test]
    fn the_states_reach_the_frontend_under_the_names_it_knows() {
        let json = serde_json::to_string(&status(
            &[PathBuf::from("/usr/local/bin")],
            &PathBuf::from("/nowhere/mdnotate"),
        ))
        .unwrap();
        assert_eq!(
            json,
            r#"{"supported":true,"appLocation":"unbundled","entries":[{"dir":"/usr/local/bin","path":"/usr/local/bin/mdnotate","state":"missing"}]}"#
        );
    }

    #[test]
    fn an_applescript_literal_is_quoted() {
        assert_eq!(applescript_quote("plain"), "\"plain\"");
    }

    /// The two characters AppleScript would otherwise read as its own, one of
    /// which `shell_quote` writes on its way through.
    #[test]
    fn an_applescript_literal_escapes_backslashes_and_quotes() {
        assert_eq!(applescript_quote(r"a\b"), r#""a\\b""#);
        assert_eq!(applescript_quote("a\"b"), r#""a\"b""#);
        assert_eq!(applescript_quote(&shell_quote("it's")), r#""'it'\\''s'""#);
    }
}
