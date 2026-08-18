//! Building the one command that is sent over ssh, and the names that go in it.
//! Strings only; the sending itself is `system`'s.

use std::collections::HashSet;
use std::path::Path;

use crate::quote::shell_quote;

/// What is left of a hostname once everything that has no business in a path is
/// taken out. `hostname -s` gives back something tame on any machine anyone has
/// named by hand, but a name is a name and this ends up in a path on someone
/// else's disk.
pub fn sanitize_host_id(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "unknown".to_string()
    } else {
        cleaned
    }
}

/// The name a local file keeps when it goes over. Only the last component: a
/// path is meaningless on the other machine, and `..` in one would be a way out
/// of the directory it is meant to land in.
pub fn remote_name(local_path: &str) -> String {
    Path::new(local_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file.md".to_string())
}

/// Keep two files sent in the same breath from becoming one.
///
/// Only within a single call: sending the same file again *later* is meant to
/// land on the same path, because that is what makes the remote app refresh the
/// window already showing it rather than open a second one. Two different files
/// of the same name in one call have no such story, so the second is renamed.
pub fn dedup_remote_name(name: &str, seen: &mut HashSet<String>) -> String {
    if seen.insert(name.to_string()) {
        return name.to_string();
    }
    let (stem, ext) = split_extension(name);
    for n in 2.. {
        let candidate = match ext {
            Some(ext) => format!("{stem}-{n}.{ext}"),
            None => format!("{stem}-{n}"),
        };
        if seen.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!("the loop only ends by returning")
}

/// Split at the last dot, unless that dot is the first character — `.zshrc` is
/// a name, not an extension.
fn split_extension(name: &str) -> (&str, Option<&str>) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], Some(&name[i + 1..])),
        _ => (name, None),
    }
}

/// The whole of what runs on the other machine: make the directory, take the
/// content off stdin, then open it there.
///
/// It has to stay one string handed over as a single argument. ssh joins
/// everything after the host with spaces and gives the result to a shell, so
/// splitting this into separate `.arg()` calls would look like an argv and be
/// nothing of the sort.
///
/// The `PATH` prefix is a literal, `$HOME` and all: it is the remote shell that
/// expands it. `cli_install::well_known_dirs` cannot stand in for it — that one
/// resolves *this* machine's home. Anywhere else the command was installed is
/// not covered on purpose; the resulting "command not found" is the signal.
pub fn push_and_launch_command(remote_dir: &str, remote_path: &str) -> String {
    format!(
        "mkdir -p {} && cat > {} && env PATH=\"/usr/local/bin:$HOME/.local/bin:$PATH\" mdnotate -- {}",
        shell_quote(remote_dir),
        shell_quote(remote_path),
        shell_quote(remote_path),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_ordinary_hostname_goes_over_unchanged() {
        assert_eq!(sanitize_host_id("mbp"), "mbp");
        assert_eq!(sanitize_host_id("reorx-mbp.local"), "reorx-mbp.local");
    }

    #[test]
    fn trailing_whitespace_from_hostname_is_dropped() {
        assert_eq!(sanitize_host_id("mbp\n"), "mbp");
    }

    #[test]
    fn anything_that_could_change_the_shape_of_a_path_is_replaced() {
        assert_eq!(sanitize_host_id("a/b"), "a_b");
        assert_eq!(sanitize_host_id(".."), "..");
        assert_eq!(sanitize_host_id("a b"), "a_b");
        assert_eq!(sanitize_host_id("笔记"), "__");
    }

    #[test]
    fn a_machine_that_will_not_say_its_name_still_gets_a_directory() {
        assert_eq!(sanitize_host_id(""), "unknown");
        assert_eq!(sanitize_host_id("   "), "unknown");
    }

    #[test]
    fn only_the_last_component_of_a_path_travels() {
        assert_eq!(remote_name("/a/b/notes.md"), "notes.md");
        assert_eq!(remote_name("notes.md"), "notes.md");
        assert_eq!(remote_name("./notes.md"), "notes.md");
    }

    /// Nothing `file_name` refuses to answer for may become a path component.
    #[test]
    fn a_path_with_no_name_of_its_own_gets_one() {
        assert_eq!(remote_name(".."), "file.md");
        assert_eq!(remote_name("/"), "file.md");
    }

    #[test]
    fn the_first_file_of_a_name_keeps_it() {
        let mut seen = HashSet::new();
        assert_eq!(dedup_remote_name("notes.md", &mut seen), "notes.md");
    }

    #[test]
    fn later_files_of_the_same_name_are_numbered_from_two() {
        let mut seen = HashSet::new();
        dedup_remote_name("notes.md", &mut seen);
        assert_eq!(dedup_remote_name("notes.md", &mut seen), "notes-2.md");
        assert_eq!(dedup_remote_name("notes.md", &mut seen), "notes-3.md");
    }

    /// The number goes before the extension, so the file still opens as what
    /// it is.
    #[test]
    fn the_number_goes_in_front_of_the_extension() {
        let mut seen = HashSet::new();
        dedup_remote_name("a.tar.gz", &mut seen);
        assert_eq!(dedup_remote_name("a.tar.gz", &mut seen), "a.tar-2.gz");
    }

    #[test]
    fn a_name_without_an_extension_just_gets_the_number() {
        let mut seen = HashSet::new();
        dedup_remote_name("README", &mut seen);
        assert_eq!(dedup_remote_name("README", &mut seen), "README-2");
    }

    /// A leading dot is part of the name, not an extension of nothing.
    #[test]
    fn a_dotfile_is_not_split_at_its_first_character() {
        let mut seen = HashSet::new();
        dedup_remote_name(".zshrc", &mut seen);
        assert_eq!(dedup_remote_name(".zshrc", &mut seen), ".zshrc-2");
    }

    /// A name that collides with one already handed out is stepped over rather
    /// than issued twice.
    #[test]
    fn a_numbered_name_that_is_itself_taken_is_skipped() {
        let mut seen = HashSet::new();
        dedup_remote_name("notes.md", &mut seen);
        dedup_remote_name("notes-2.md", &mut seen);
        assert_eq!(dedup_remote_name("notes.md", &mut seen), "notes-3.md");
    }

    #[test]
    fn the_remote_command_is_exactly_this() {
        assert_eq!(
            push_and_launch_command("/tmp/mdnotate/mbp", "/tmp/mdnotate/mbp/notes.md"),
            "mkdir -p '/tmp/mdnotate/mbp' && cat > '/tmp/mdnotate/mbp/notes.md' \
             && env PATH=\"/usr/local/bin:$HOME/.local/bin:$PATH\" mdnotate -- '/tmp/mdnotate/mbp/notes.md'"
        );
    }

    /// A quote in a filename must not end the literal the remote shell is
    /// reading.
    #[test]
    fn a_quote_in_a_name_is_escaped_on_the_way_over() {
        let command = push_and_launch_command("/tmp/mdnotate/mbp", "/tmp/mdnotate/mbp/it's.md");
        assert!(
            command.contains(r"'/tmp/mdnotate/mbp/it'\''s.md'"),
            "{command}"
        );
    }
}
