//! Reading the last thing Claude Code said out of a session transcript.
//!
//! Ported from `~/Code/plannotator/apps/hook/server/session-log.ts`, which is
//! where this was worked out against several hundred real transcripts. What is
//! left out: the picker's list of recent messages, anchoring on a prompt, and
//! everything to do with Droid — this command wants one message.
//!
//! A transcript is JSONL, one object per line, and three things about it are
//! not obvious:
//!
//!   - One message the user sees may be several lines, streamed in chunks that
//!     share a `message.id`. They have to be joined back together.
//!   - The file is a *tree*, not a list. `/rewind` writes nothing; the next
//!     message simply points its `parentUuid` at an earlier entry, orphaning
//!     everything after it. Read bottom-up in file order, it hands back
//!     messages the user can no longer see.
//!   - Plenty of lines look like conversation and are not: tool results and
//!     command output are logged as `user` entries.
//!
//! Every field is read off a `serde_json::Value` rather than deserialized into
//! a struct, because a struct makes any unexpected *type* — not just an
//! unexpected shape — throw the whole line away, and a silently dropped line is
//! exactly the failure this cannot afford.

use std::collections::{HashMap, HashSet};

use serde_json::Value;

/// What the user is given back: the text of one message, chunks rejoined.
#[derive(Debug, PartialEq, Eq)]
pub struct RenderedMessage {
    pub text: String,
}

/// Entries that look like the user talking but are the harness talking.
const SYSTEM_USER_PREFIXES: [&str; 6] = [
    "<local-command-",
    "<command-name>",
    "<local-command-stdout>",
    "<local-command-stderr>",
    "<system-reminder>",
    "<system-notification>",
];

/// Bookkeeping lines that are neither side of the conversation.
const NOISE_TYPES: [&str; 4] = [
    "progress",
    "system",
    "file-history-snapshot",
    "queue-operation",
];

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Role {
    User,
    Assistant,
}

/// What an entry says about the one before it.
#[derive(Debug, PartialEq, Eq)]
enum Parent<'a> {
    /// `null` or absent: the start of the tree, or a `/compact` boundary.
    Root,
    Uuid(&'a str),
    /// Neither a string nor null. Nothing can be made of it, and guessing is
    /// worse than saying so.
    Untrusted,
}

pub struct Entry(Value);

impl Entry {
    fn str_field(&self, key: &str) -> Option<&str> {
        self.0.get(key)?.as_str()
    }

    fn message(&self) -> Option<&Value> {
        self.0.get("message")
    }

    fn kind(&self) -> &str {
        self.str_field("type").unwrap_or_default()
    }

    fn uuid(&self) -> Option<&str> {
        self.str_field("uuid").filter(|u| !u.is_empty())
    }

    fn parent(&self) -> Parent<'_> {
        match self.0.get("parentUuid") {
            None | Some(Value::Null) => Parent::Root,
            Some(Value::String(uuid)) => Parent::Uuid(uuid),
            Some(_) => Parent::Untrusted,
        }
    }

    fn role(&self) -> Option<Role> {
        let named = match self.kind() {
            "user" => Some(Role::User),
            "assistant" => Some(Role::Assistant),
            _ => None,
        };
        if named.is_some() {
            return named;
        }
        match self.message()?.get("role")?.as_str()? {
            "user" => Some(Role::User),
            "assistant" => Some(Role::Assistant),
            _ => None,
        }
    }

    /// Written for the model's eyes only, and never shown in the transcript.
    fn hidden(&self) -> bool {
        let visibility = self
            .str_field("visibility")
            .or_else(|| self.message()?.get("visibility")?.as_str());
        matches!(
            visibility.map(|v| v.trim().to_ascii_lowercase()).as_deref(),
            Some("llm_only" | "assistant_only" | "hidden")
        )
    }

    /// The id shared by every chunk of one streamed message.
    fn message_id(&self) -> Option<&str> {
        self.message()
            .and_then(|m| m.get("id"))
            .and_then(Value::as_str)
            .or_else(|| self.str_field("id"))
    }

    /// The parts of this entry that were rendered as prose. `content` is a
    /// string on some entries and a list of blocks on others; only `text`
    /// blocks are shown, so tool calls fall away here.
    fn visible_text(&self) -> Vec<&str> {
        let Some(content) = self.message().and_then(|m| m.get("content")) else {
            return Vec::new();
        };
        match content {
            Value::String(s) if !s.trim().is_empty() => vec![s.as_str()],
            Value::Array(blocks) => blocks
                .iter()
                .filter_map(|block| {
                    if block.get("type")?.as_str()? != "text" {
                        return None;
                    }
                    let text = block.get("text")?.as_str()?;
                    (!text.trim().is_empty()).then_some(text)
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Somebody actually typed this, as against a tool result or a caveat the
    /// harness logged under the user's name.
    fn is_human_prompt(&self) -> bool {
        if self.role() != Some(Role::User) || self.hidden() {
            return false;
        }
        let blocks = self.visible_text();
        if blocks.is_empty() {
            return false;
        }
        let joined = blocks.join("\n");
        !SYSTEM_USER_PREFIXES
            .iter()
            .any(|prefix| joined.starts_with(prefix))
    }

    fn assistant_text(&self) -> Vec<&str> {
        if self.role() != Some(Role::Assistant) || self.hidden() {
            return Vec::new();
        }
        self.visible_text()
    }
}

/// One entry per line that is an object. A malformed line is skipped rather
/// than fatal: a transcript being written while it is read can end mid-line.
pub fn parse_session_log(content: &str) -> Vec<Entry> {
    content
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|value| value.is_object())
        .map(Entry)
        .collect()
}

/// Which entries are on the branch the conversation is actually on.
///
/// Walks `parentUuid` back from the newest entry that has a `uuid` — not
/// necessarily the last line, since bookkeeping types carry no id and are
/// often written last.
///
/// `None` means the chain cannot be trusted (no ids at all, a cycle, a parent
/// that is not there, or one that is not a string), and the caller should read
/// the file in order instead. Returning nothing here would be worse than
/// returning too much.
fn active_branch(entries: &[Entry]) -> Option<HashSet<usize>> {
    let mut by_uuid: HashMap<&str, usize> = HashMap::new();
    let mut newest = None;
    for (i, entry) in entries.iter().enumerate() {
        if let Some(uuid) = entry.uuid() {
            by_uuid.insert(uuid, i);
            newest = Some(i);
        }
    }

    let mut cursor = newest?;
    let mut branch = HashSet::new();
    loop {
        // A cycle would spin forever; a revisit means the chain is not one.
        if !branch.insert(cursor) {
            return None;
        }
        match entries[cursor].parent() {
            Parent::Root => return Some(branch),
            Parent::Untrusted => return None,
            Parent::Uuid(uuid) => cursor = *by_uuid.get(uuid)?,
        }
    }
}

/// The last message the user saw, walking backwards from the end of the file.
///
/// Locks onto the newest assistant entry that has text, then keeps collecting
/// earlier chunks of that same `message.id`. A human prompt ends the search
/// once something has been found; before that it is stepped over, so that a
/// turn whose newest entries are all tool calls falls through to the reply
/// before it.
fn extract(entries: &[Entry], branch: Option<&HashSet<usize>>) -> Option<RenderedMessage> {
    let mut target: Option<&str> = None;
    let mut parts: Vec<&str> = Vec::new();

    for i in (0..entries.len()).rev() {
        if branch.is_some_and(|branch| !branch.contains(&i)) {
            continue;
        }
        let entry = &entries[i];
        if NOISE_TYPES.contains(&entry.kind()) {
            continue;
        }

        if entry.is_human_prompt() {
            if !parts.is_empty() {
                break;
            }
            continue;
        }
        // Everything else logged under the user's name is a tool result.
        if entry.role() != Some(Role::Assistant) {
            continue;
        }

        if let Some(target) = target {
            // An earlier chunk of the message being collected, or the end of it.
            match entry.message_id() {
                Some(id) if id == target => parts.extend(entry.assistant_text()),
                _ => break,
            }
            continue;
        }

        let texts = entry.assistant_text();
        if texts.is_empty() {
            continue;
        }
        let Some(id) = entry.message_id() else {
            continue;
        };
        target = Some(id);
        parts.extend(texts);
    }

    if parts.is_empty() {
        return None;
    }
    // Collected newest-first; the message reads the other way round.
    parts.reverse();
    Some(RenderedMessage {
        text: parts.join("\n"),
    })
}

/// The last rendered assistant message in a transcript.
///
/// Fail open, never fail empty: the active branch is preferred, but right after
/// a `/compact` that branch is a fresh root with no assistant messages on it at
/// all. Returning nothing there would make the caller decide it had the wrong
/// file and go looking at an older session, which is strictly worse than
/// offering the message the user just watched scroll past.
pub fn get_last_rendered_message(content: &str) -> Option<RenderedMessage> {
    let entries = parse_session_log(content);
    if let Some(branch) = active_branch(&entries) {
        if let Some(message) = extract(&entries, Some(&branch)) {
            return Some(message);
        }
    }
    extract(&entries, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One assistant entry, as a transcript line.
    fn assistant(uuid: &str, parent: &str, id: &str, text: &str) -> String {
        format!(
            r#"{{"type":"assistant","uuid":"{uuid}","parentUuid":{},"message":{{"id":"{id}","role":"assistant","content":[{{"type":"text","text":"{text}"}}]}}}}"#,
            parent_json(parent)
        )
    }

    fn user(uuid: &str, parent: &str, text: &str) -> String {
        format!(
            r#"{{"type":"user","uuid":"{uuid}","parentUuid":{},"message":{{"role":"user","content":"{text}"}}}}"#,
            parent_json(parent)
        )
    }

    fn parent_json(parent: &str) -> String {
        if parent.is_empty() {
            "null".to_string()
        } else {
            format!("\"{parent}\"")
        }
    }

    fn log(lines: &[String]) -> String {
        lines.join("\n")
    }

    fn text_of(content: &str) -> Option<String> {
        get_last_rendered_message(content).map(|m| m.text)
    }

    #[test]
    fn the_last_reply_is_what_comes_back() {
        let content = log(&[
            user("u1", "", "hello"),
            assistant("a1", "u1", "m1", "first reply"),
            user("u2", "a1", "again"),
            assistant("a2", "u2", "m2", "second reply"),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("second reply"));
    }

    /// One bubble in the UI is several lines in the file, streamed.
    #[test]
    fn chunks_of_one_message_are_rejoined_in_order() {
        let content = log(&[
            user("u1", "", "hello"),
            assistant("a1", "u1", "m1", "part one"),
            assistant("a2", "a1", "m1", "part two"),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("part one\npart two"));
    }

    #[test]
    fn an_earlier_message_is_not_swept_up_with_the_last_one() {
        let content = log(&[
            assistant("a1", "", "m1", "older"),
            assistant("a2", "a1", "m2", "newer"),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("newer"));
    }

    /// A turn that ends in tool calls has no text of its own, so the reply
    /// before it is what the user is still looking at.
    #[test]
    fn a_turn_of_nothing_but_tool_calls_falls_through_to_the_reply_before_it() {
        let tool_only = r#"{"type":"assistant","uuid":"a2","parentUuid":"u2","message":{"id":"m2","role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{}}]}}"#;
        let content = log(&[
            user("u1", "", "hello"),
            assistant("a1", "u1", "m1", "the reply"),
            user("u2", "a1", "do a thing"),
            tool_only.to_string(),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("the reply"));
    }

    #[test]
    fn a_tool_result_logged_as_a_user_entry_is_stepped_over() {
        let tool_result = r#"{"type":"user","uuid":"u2","parentUuid":"a1","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}"#;
        let content = log(&[
            user("u1", "", "hello"),
            assistant("a1", "u1", "m1", "the reply"),
            tool_result.to_string(),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("the reply"));
    }

    #[test]
    fn the_harness_talking_under_the_users_name_is_not_a_prompt() {
        let noise = r#"{"type":"user","uuid":"u2","parentUuid":"a1","message":{"role":"user","content":"<system-reminder>be good</system-reminder>"}}"#;
        let content = log(&[
            user("u1", "", "hello"),
            assistant("a1", "u1", "m1", "the reply"),
            noise.to_string(),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("the reply"));
    }

    #[test]
    fn a_message_written_for_the_model_alone_is_not_shown() {
        let hidden = r#"{"type":"assistant","uuid":"a2","parentUuid":"a1","visibility":"llm_only","message":{"id":"m2","role":"assistant","content":[{"type":"text","text":"internal"}]}}"#;
        let content = log(&[
            assistant("a1", "", "m1", "the reply"),
            hidden.to_string(),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("the reply"));
    }

    #[test]
    fn bookkeeping_lines_are_not_conversation() {
        let content = log(&[
            assistant("a1", "", "m1", "the reply"),
            r#"{"type":"progress","uuid":"p1","parentUuid":"a1"}"#.to_string(),
            r#"{"type":"file-history-snapshot"}"#.to_string(),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("the reply"));
    }

    #[test]
    fn a_line_that_is_not_json_is_skipped_rather_than_fatal() {
        let content = log(&[
            assistant("a1", "", "m1", "the reply"),
            "{ this is not json".to_string(),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("the reply"));
    }

    #[test]
    fn a_transcript_with_no_reply_in_it_yet_has_nothing_to_give() {
        let content = log(&[user("u1", "", "hello")]);
        assert_eq!(text_of(&content), None);
        assert_eq!(text_of(""), None);
    }

    /// What `/rewind` leaves behind: the abandoned reply is still in the file,
    /// after the one the user can see, and must not be the answer.
    #[test]
    fn a_reply_orphaned_by_a_rewind_is_not_the_last_one() {
        let content = log(&[
            user("u1", "", "hello"),
            assistant("a1", "u1", "m1", "abandoned"),
            // Re-parented to the prompt, so `a1` is off the branch.
            assistant("a2", "u1", "m2", "the live one"),
        ]);
        // The newest entry with a uuid is a2, whose parent is u1, whose parent
        // is the root — a1 never appears on that walk.
        assert_eq!(text_of(&content).as_deref(), Some("the live one"));
    }

    #[test]
    fn a_transcript_with_no_ids_at_all_is_read_in_file_order() {
        let content = log(&[
            r#"{"type":"assistant","message":{"id":"m1","role":"assistant","content":[{"type":"text","text":"the reply"}]}}"#.to_string(),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("the reply"));
    }

    #[test]
    fn a_chain_that_dead_ends_falls_back_to_file_order() {
        let content = log(&[
            assistant("a1", "", "m1", "older"),
            assistant("a2", "nowhere", "m2", "newer"),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("newer"));
    }

    #[test]
    fn a_chain_that_loops_falls_back_to_file_order() {
        let content = log(&[
            assistant("a1", "a2", "m1", "older"),
            assistant("a2", "a1", "m2", "newer"),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("newer"));
    }

    /// A `parentUuid` that is neither a string nor null says nothing that can
    /// be walked, and must not take the whole line down with it.
    #[test]
    fn a_parent_that_is_not_a_string_falls_back_to_file_order() {
        let content = log(&[
            assistant("a1", "", "m1", "older"),
            r#"{"type":"assistant","uuid":"a2","parentUuid":42,"message":{"id":"m2","role":"assistant","content":[{"type":"text","text":"newer"}]}}"#.to_string(),
        ]);
        assert_eq!(text_of(&content).as_deref(), Some("newer"));
    }

    /// Right after a `/compact` the live branch is a fresh root with nothing on
    /// it. Answering "no reply here" would send the caller off to an older
    /// session; the message the user just watched scroll by is the better one.
    #[test]
    fn a_freshly_compacted_branch_falls_back_rather_than_coming_back_empty() {
        let content = log(&[
            user("u1", "", "hello"),
            assistant("a1", "u1", "m1", "before the compaction"),
            // A compaction boundary is a second root, and it has no reply yet.
            user("u2", "", "after"),
        ]);
        assert_eq!(
            text_of(&content).as_deref(),
            Some("before the compaction")
        );
    }
}
