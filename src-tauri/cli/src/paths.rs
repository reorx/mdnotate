//! Where content that has no file of its own is put before it is opened.
//!
//! Piped input and an extracted message are text this command holds in memory
//! and nothing else knows about; the app only opens files, so they are written
//! out first. `/tmp` because these are scratch documents — the annotations made
//! on them live in the database keyed by content, not here.
//!
//! Two shapes, and the difference matters. A file that is *pushed* keeps its
//! own name, under a directory named after the machine it came from, so that
//! the same file sent twice lands on the same path and the remote app treats
//! the second one as a refresh of the window already showing it. Content that
//! is *generated* has no name to keep, so it gets a fresh one every time.

use std::path::PathBuf;

pub const ROOT: &str = "/tmp/mdnotate";

/// The name of the directory generated clipboard documents go in.
pub const CLIPBOARD: &str = "clipboard";
/// …and extracted assistant messages.
pub const LAST: &str = "last";

/// What makes one run's generated file distinct from the next one's. Two
/// commands started in the same second are told apart by the pid.
pub fn stamp(timestamp: &str, pid: u32) -> String {
    format!("{timestamp}-{pid}")
}

/// Generated content that stays on this machine. Under `local/` rather than at
/// the top, so it sits beside the per-host directories instead of among them.
pub fn local_content_path(kind: &str, stamp: &str) -> PathBuf {
    PathBuf::from(ROOT)
        .join("local")
        .join(kind)
        .join(format!("{stamp}.md"))
}

/// Where files pushed from this machine land on the other one.
pub fn remote_dir(host_id: &str) -> String {
    format!("{ROOT}/{host_id}")
}

/// Where generated content pushed from this machine lands.
pub fn remote_content_dir(host_id: &str, kind: &str) -> String {
    format!("{ROOT}/{host_id}/{kind}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_content_is_named_for_when_and_by_whom_it_was_made() {
        assert_eq!(stamp("20260818-101530", 4242), "20260818-101530-4242");
    }

    #[test]
    fn local_generated_content_sits_beside_the_per_host_directories() {
        assert_eq!(
            local_content_path(CLIPBOARD, "20260818-101530-4242"),
            PathBuf::from("/tmp/mdnotate/local/clipboard/20260818-101530-4242.md")
        );
    }

    #[test]
    fn a_pushed_file_lands_under_the_name_of_the_machine_it_came_from() {
        assert_eq!(remote_dir("mbp"), "/tmp/mdnotate/mbp");
        assert_eq!(remote_content_dir("mbp", LAST), "/tmp/mdnotate/mbp/last");
    }
}
