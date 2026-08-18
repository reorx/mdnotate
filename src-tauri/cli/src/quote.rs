//! Two helpers copied out of `src-tauri/src/lib.rs`, where the app uses them
//! for exactly the same job.
//!
//! Copied rather than shared: importing them would make this command depend on
//! `mdnotate_lib`, and with it on tauri, sqlx and the rest of the app's tree —
//! for thirty lines. The same accepted duplication as `OPENABLE_EXTENSIONS`,
//! and like it, a change on one side has to be made on the other.

/// Wrap a path for the remote shell. ssh joins its trailing arguments with
/// spaces and hands the result to a shell we do not control, so the path has to
/// arrive already quoted or every space in it becomes an argument break.
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// The most useful line of ssh's complaint, which is the last one it wrote.
pub fn last_line(stderr: &str) -> String {
    stderr
        .lines()
        .filter(|l| !l.trim().is_empty())
        .next_back()
        .unwrap_or("no output")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_path_is_wrapped_in_single_quotes() {
        assert_eq!(shell_quote("/tmp/a b.md"), "'/tmp/a b.md'");
    }

    #[test]
    fn an_embedded_quote_closes_and_reopens_the_literal() {
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
    }

    #[test]
    fn the_last_thing_written_is_what_gets_reported() {
        assert_eq!(last_line("first\nsecond\n\n"), "second");
    }

    #[test]
    fn silence_still_says_something() {
        assert_eq!(last_line("   \n"), "no output");
    }
}
