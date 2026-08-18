//! Telling the three kinds of argument apart, and wrapping the two that are not
//! files into a link.
//!
//! The grammar itself belongs to `src/lib/doc-locator.ts` and is read there;
//! all that is needed here is enough of it to know which of `open`'s two doors
//! an argument goes through. That single rule — a colon before the first slash
//! names a host — is the only piece repeated.

/// The prefix of a link, matched without regard to case because `open` and
/// LaunchServices do not care about it either.
const SCHEME: &str = "mdnotate://";

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Kind {
    /// Already a link: passed on whole rather than wrapped in a second one,
    /// which would bury it in its own `path` parameter.
    Link,
    /// `host:path` — a file on another machine, which `open` would only look
    /// for under that name here, so it has to go as a link.
    Remote,
    /// A path on this machine, absolute or relative to the current directory.
    Local,
}

pub fn classify(arg: &str) -> Kind {
    if arg
        .get(..SCHEME.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(SCHEME))
    {
        return Kind::Link;
    }
    // A colon *before the first slash* names a host, so `/notes/2026:08:11.md`
    // is still a local file.
    match arg.split('/').next() {
        Some(head) if head.contains(':') => Kind::Remote,
        _ => Kind::Local,
    }
}

/// Wrap a `host:path` into the link the app reads it back out of.
///
/// The path has to travel as a query parameter: `application:openURLs:` runs
/// every URL through a parser first and drops what it cannot make sense of,
/// and `mdnotate://host:path/…` is precisely that — the `:path` in the
/// authority is read as a port.
pub fn link_for(arg: &str) -> String {
    format!("{SCHEME}open?path={}", urlencode(arg))
}

/// Percent-encode one argument to go in a link.
///
/// Byte by byte, escaping everything outside RFC 3986's unreserved set, which
/// is what `encodeURIComponent` does and what the link grammar needs: `&` and
/// `#` have to arrive as %26 and %23 or the query is cut short at them.
/// Escaping more than strictly necessary costs nothing — the other end reads
/// the value back through `URLSearchParams`, which decodes whatever it is given.
pub fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'~' | b'-' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absolute_path_is_local() {
        assert_eq!(classify("/Users/me/notes.md"), Kind::Local);
    }

    #[test]
    fn a_relative_path_is_local() {
        assert_eq!(classify("notes/a.md"), Kind::Local);
    }

    /// The rule this module exists to state: a colon after the first slash is
    /// part of a filename, not a host.
    #[test]
    fn a_colon_inside_a_path_does_not_make_it_remote() {
        assert_eq!(classify("/notes/2026:08:11.md"), Kind::Local);
        assert_eq!(classify("./notes/2026:08:11.md"), Kind::Local);
    }

    #[test]
    fn a_colon_before_the_first_slash_names_a_host() {
        assert_eq!(classify("maiev.ts:Sync/a.md"), Kind::Remote);
        assert_eq!(classify("maiev.ts:/abs/a.md"), Kind::Remote);
        assert_eq!(classify("maiev.ts:a.md"), Kind::Remote);
    }

    #[test]
    fn a_link_is_recognised_whatever_its_case() {
        assert_eq!(classify("mdnotate://open?path=%2Fa.md"), Kind::Link);
        assert_eq!(classify("MDNOTATE://open?path=%2Fa.md"), Kind::Link);
        assert_eq!(classify("MdNotate://open?path=%2Fa.md"), Kind::Link);
    }

    /// The scheme is eleven bytes; a shorter argument must not be sliced at a
    /// byte that is halfway through a character.
    #[test]
    fn a_short_multibyte_argument_is_not_sliced_apart() {
        assert_eq!(classify("笔记.md"), Kind::Local);
        assert_eq!(classify("md"), Kind::Local);
    }

    #[test]
    fn unreserved_characters_go_over_as_they_are() {
        assert_eq!(urlencode("aZ0._~-"), "aZ0._~-");
    }

    /// The two that cut the query short if they arrive unescaped.
    #[test]
    fn ampersand_and_hash_are_escaped() {
        assert_eq!(urlencode("a&b#c"), "a%26b%23c");
    }

    #[test]
    fn the_separators_of_a_remote_path_are_escaped() {
        assert_eq!(urlencode("h:Sync/a.md"), "h%3ASync%2Fa.md");
    }

    /// One escape per byte, not per character — the other end decodes UTF-8.
    #[test]
    fn a_non_ascii_character_is_escaped_byte_by_byte() {
        assert_eq!(urlencode("é"), "%C3%A9");
        assert_eq!(urlencode("笔"), "%E7%AC%94");
    }

    #[test]
    fn a_remote_path_becomes_a_link_the_app_can_read() {
        assert_eq!(
            link_for("h:Sync/a.md"),
            "mdnotate://open?path=h%3ASync%2Fa.md"
        );
    }
}
