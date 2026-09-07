//! Which build this is, and what that does to the bundle identifier.
//!
//! Everything Tauri stores per app hangs off `config.identifier`: the data
//! directory (so the SQLite file and `settings.json` inside it), and the
//! single-instance socket under `/tmp`. A `tauri dev` binary that keeps the
//! release identifier therefore shares all of it with the copy installed in
//! /Applications — and the two drift: the dev build applies a migration the
//! installed one has never heard of, and from then on the installed one
//! cannot open the database at all ("migration N was previously applied but
//! is missing in the resolved migrations"). Or the installed one receives a
//! document meant for the dev instance, because they answer on the same
//! socket.
//!
//! So the debug build runs under its own identifier. The flag is decided at
//! compile time — `cfg!(debug_assertions)` is exactly the line between
//! `tauri dev` and `tauri build` — and applied once, before the app is built,
//! by rewriting the identifier in the generated context. Nothing downstream
//! needs to know: the path resolver, the sql and store plugins and the
//! single-instance plugin all read the identifier from the runtime config.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// `tauri build`: the identifier from `tauri.conf.json`, untouched.
    Release,
    /// `tauri dev` (and `tauri build --debug`): its own data, its own socket.
    Dev,
}

/// Fixed when the binary was compiled, not by anything at runtime.
pub fn current() -> Channel {
    if cfg!(debug_assertions) {
        Channel::Dev
    } else {
        Channel::Release
    }
}

/// The identifier the app should actually run under.
pub fn identifier(configured: &str, channel: Channel) -> String {
    match channel {
        Channel::Release => configured.to_string(),
        Channel::Dev => format!("{configured}.dev"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_build_keeps_the_configured_identifier() {
        assert_eq!(
            identifier("top.ideachat.mdnotate", Channel::Release),
            "top.ideachat.mdnotate"
        );
    }

    #[test]
    fn a_dev_build_runs_under_its_own_identifier() {
        assert_eq!(
            identifier("top.ideachat.mdnotate", Channel::Dev),
            "top.ideachat.mdnotate.dev"
        );
    }

    /// The suffix is what keeps the two apart; it must stay a valid reverse-DNS
    /// segment or the single-instance socket name and data directory break.
    #[test]
    fn the_dev_identifier_is_still_reverse_dns() {
        let id = identifier("top.ideachat.mdnotate", Channel::Dev);
        assert!(id.split('.').all(|seg| !seg.is_empty() && seg.chars().all(|c| c.is_ascii_alphanumeric())));
    }
}
