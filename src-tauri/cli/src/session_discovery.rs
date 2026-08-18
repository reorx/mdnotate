//! Working out which transcript belongs to the Claude Code session this
//! command was run from.
//!
//! Ported from `~/Code/plannotator/apps/hook/server/session-log.ts`. Four ways
//! of answering, tried in order of how much each one really knows:
//!
//!   1. Walk up the process tree looking for `~/.claude/sessions/<pid>.json`.
//!      This is the only one that identifies *this* session rather than a
//!      likely one. The direct parent is a shell, so it takes a few hops.
//!   2. Read every session metadata file and take the one whose `cwd` matches
//!      and that started most recently. Session-level, so unaffected by an
//!      unrelated process touching a file.
//!   3. The newest `.jsonl` in `projects/<slug>/`, by modification time.
//!   4. The same, but trying each parent directory in turn, for someone who
//!      `cd`'d deeper after the session started.
//!
//! All four are returned, in that order, rather than only the first that
//! resolves: a path is not proof that the file has anything in it, and the
//! caller reads down the list until one yields a message.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// Far enough to get from a `!`-bang subshell up to Claude Code itself, and
/// short enough not to walk the whole tree when the answer is not there.
const MAX_HOPS: usize = 8;

/// The two directories under `~/.claude` this reads.
pub struct Dirs {
    pub sessions: PathBuf,
    pub projects: PathBuf,
}

impl Dirs {
    pub fn from_env() -> Self {
        let root = std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".claude")
            });
        Self {
            sessions: root.join("sessions"),
            projects: root.join("projects"),
        }
    }
}

/// What Claude Code writes beside each running process.
#[derive(Deserialize)]
struct SessionMetadata {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    cwd: Option<String>,
    #[serde(rename = "startedAt")]
    started_at: Option<f64>,
}

/// The directory name Claude Code files a project's transcripts under.
///
/// It writes this slug from JavaScript, where a string is a sequence of UTF-16
/// code units — a character outside the BMP is two of them and comes out as two
/// dashes. Walking Rust `char`s would write one, and the directory would not be
/// found.
pub fn project_slug_from_cwd(cwd: &str) -> String {
    cwd.encode_utf16()
        .map(|unit| match unit {
            0x30..=0x39 | 0x41..=0x5A | 0x61..=0x7A | 0x2D => {
                char::from_u32(u32::from(unit)).unwrap_or('-')
            }
            _ => '-',
        })
        .collect()
}

/// Every transcript in a project directory, newest first.
pub fn find_session_logs(project_dir: &Path) -> Vec<PathBuf> {
    let Ok(dir) = std::fs::read_dir(project_dir) else {
        return Vec::new();
    };
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = dir
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            if path.extension()? != "jsonl" {
                return None;
            }
            // The file may have gone between listing it and asking about it.
            Some((path.metadata().ok()?.modified().ok()?, path))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

pub fn find_session_logs_for_cwd(cwd: &str, projects: &Path) -> Vec<PathBuf> {
    find_session_logs(&projects.join(project_slug_from_cwd(cwd)))
}

/// Turn `ps -eo pid=,ppid=` into a table. A line that is not two numbers is
/// skipped rather than fatal.
pub fn parse_process_table(stdout: &str) -> HashMap<u32, u32> {
    let mut table = HashMap::new();
    for line in stdout.lines() {
        let mut fields = line.split_whitespace();
        let (Some(pid), Some(ppid)) = (fields.next(), fields.next()) else {
            continue;
        };
        if let (Ok(pid), Ok(ppid)) = (pid.parse(), ppid.parse()) {
            table.insert(pid, ppid);
        }
    }
    table
}

/// The chain of processes from `start` upwards, `start` included.
///
/// Stops at init, at a repeat — a table read while processes come and go can
/// describe a loop that does not exist — and at `max_hops`.
pub fn ancestor_pids(start: u32, max_hops: usize, parent: &dyn Fn(u32) -> Option<u32>) -> Vec<u32> {
    let mut chain = Vec::new();
    let mut seen = HashSet::new();
    let mut current = Some(start);
    while chain.len() < max_hops {
        let Some(pid) = current else { break };
        if pid <= 1 || !seen.insert(pid) {
            break;
        }
        chain.push(pid);
        current = parent(pid);
    }
    chain
}

fn read_session_metadata(pid: u32, sessions: &Path) -> Option<SessionMetadata> {
    let raw = std::fs::read_to_string(sessions.join(format!("{pid}.json"))).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Whether any process claims this session. Used to tell a session that `/clear`
/// created and never registered — which is the one being typed into — from a
/// legitimate second session running alongside.
fn is_session_registered(session_id: &str, sessions: &Path) -> bool {
    let Ok(dir) = std::fs::read_dir(sessions) else {
        return false;
    };
    dir.filter_map(|entry| {
        let path = entry.ok()?.path();
        if path.extension()? != "json" {
            return None;
        }
        let raw = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str::<SessionMetadata>(&raw).ok()?.session_id
    })
    .any(|id| id == session_id)
}

/// Tier 1: the session belonging to one of this process's ancestors.
pub fn resolve_by_ancestor_pids(
    start_pid: u32,
    dirs: &Dirs,
    parent: &dyn Fn(u32) -> Option<u32>,
) -> Option<PathBuf> {
    for pid in ancestor_pids(start_pid, MAX_HOPS, parent) {
        let Some(meta) = read_session_metadata(pid, &dirs.sessions) else {
            continue;
        };
        let (Some(session_id), Some(cwd)) = (meta.session_id, meta.cwd) else {
            continue;
        };
        let candidates = find_session_logs_for_cwd(&cwd, &dirs.projects);
        let Some(matched) = candidates
            .iter()
            .find(|path| path.to_string_lossy().contains(&session_id))
        else {
            continue;
        };
        // The metadata can be stale: `/clear` starts a new transcript without
        // rewriting it. A newer transcript that no process claims is that new
        // session, and is the one being typed into.
        if candidates[0] != *matched {
            let newest = candidates[0]
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            if !is_session_registered(&newest, &dirs.sessions) {
                return Some(candidates[0].clone());
            }
        }
        return Some(matched.clone());
    }
    None
}

/// Tier 2: the most recently started session whose `cwd` is this one.
pub fn resolve_by_cwd_scan(cwd: &str, dirs: &Dirs) -> Option<PathBuf> {
    let dir = std::fs::read_dir(&dirs.sessions).ok()?;
    let mut candidates: Vec<(f64, String)> = dir
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            if path.extension()? != "json" {
                return None;
            }
            let raw = std::fs::read_to_string(&path).ok()?;
            let meta: SessionMetadata = serde_json::from_str(&raw).ok()?;
            if meta.cwd.as_deref() != Some(cwd) {
                return None;
            }
            Some((meta.started_at.unwrap_or(0.0), meta.session_id?))
        })
        .collect();
    candidates.sort_by(|a, b| b.0.total_cmp(&a.0));

    let logs = find_session_logs_for_cwd(cwd, &dirs.projects);
    candidates.into_iter().find_map(|(_, session_id)| {
        logs.iter()
            .find(|path| path.to_string_lossy().contains(&session_id))
            .cloned()
    })
}

/// Tier 4: the transcripts of the nearest ancestor directory that has any, for
/// someone who `cd`'d deeper after the session started.
pub fn find_logs_by_ancestor_walk(cwd: &Path, projects: &Path) -> Vec<PathBuf> {
    let mut dir = cwd.parent();
    while let Some(current) = dir {
        let logs = find_session_logs_for_cwd(&current.to_string_lossy(), projects);
        if !logs.is_empty() {
            return logs;
        }
        dir = current.parent();
    }
    Vec::new()
}

/// Every transcript worth looking in, best guess first and no repeats.
pub fn transcript_candidates(
    cwd: &Path,
    start_pid: u32,
    dirs: &Dirs,
    parent: &dyn Fn(u32) -> Option<u32>,
) -> Vec<PathBuf> {
    let cwd_string = cwd.to_string_lossy().into_owned();
    let tiers = [
        resolve_by_ancestor_pids(start_pid, dirs, parent)
            .into_iter()
            .collect(),
        resolve_by_cwd_scan(&cwd_string, dirs).into_iter().collect(),
        find_session_logs_for_cwd(&cwd_string, &dirs.projects),
        find_logs_by_ancestor_walk(cwd, &dirs.projects),
    ];

    let mut seen = HashSet::new();
    let mut ordered = Vec::new();
    for tier in tiers {
        for path in tier {
            if seen.insert(path.clone()) {
                ordered.push(path);
            }
        }
    }
    ordered
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A directory of its own for each test, since they run at the same time.
    /// Same shape as `cli_install.rs`'s, and for the same reason: no dev
    /// dependency buys anything here.
    fn scratch() -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "mdnotate-cli-session-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn dirs_in(root: &Path) -> Dirs {
        let dirs = Dirs {
            sessions: root.join("sessions"),
            projects: root.join("projects"),
        };
        std::fs::create_dir_all(&dirs.sessions).unwrap();
        std::fs::create_dir_all(&dirs.projects).unwrap();
        dirs
    }

    /// A transcript for `cwd`, written under the slug Claude Code would use.
    fn write_log(dirs: &Dirs, cwd: &str, session_id: &str, body: &str) -> PathBuf {
        let dir = dirs.projects.join(project_slug_from_cwd(cwd));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{session_id}.jsonl"));
        std::fs::write(&path, body).unwrap();
        path
    }

    fn write_meta(dirs: &Dirs, pid: u32, session_id: &str, cwd: &str, started_at: u64) {
        std::fs::write(
            dirs.sessions.join(format!("{pid}.json")),
            format!(
                r#"{{"pid":{pid},"sessionId":"{session_id}","cwd":"{cwd}","startedAt":{started_at}}}"#
            ),
        )
        .unwrap();
    }

    /// Give a file a modification time far enough apart to sort by.
    fn age(path: &Path, seconds_ago: u64) {
        let when = std::time::SystemTime::now() - std::time::Duration::from_secs(seconds_ago);
        let times = std::fs::FileTimes::new().set_modified(when);
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_times(times)
            .unwrap();
    }

    #[test]
    fn a_path_becomes_the_directory_name_claude_code_files_it_under() {
        assert_eq!(
            project_slug_from_cwd("/Users/reorx/Code/mdnotate"),
            "-Users-reorx-Code-mdnotate"
        );
    }

    #[test]
    fn dashes_and_digits_survive_the_slug_and_nothing_else_does() {
        assert_eq!(project_slug_from_cwd("/a-b/c_d.9"), "-a-b-c-d-9");
    }

    /// The slug is written by JavaScript, where this character is two code
    /// units and so two dashes.
    #[test]
    fn a_character_outside_the_bmp_becomes_two_dashes() {
        assert_eq!(project_slug_from_cwd("/a/🙂"), "-a---");
    }

    #[test]
    fn the_process_table_is_read_as_pairs_of_numbers() {
        let table = parse_process_table("  501   1\n 502  501\n\ngarbage\n700\n");
        assert_eq!(table.get(&501), Some(&1));
        assert_eq!(table.get(&502), Some(&501));
        assert_eq!(table.len(), 2);
    }

    #[test]
    fn the_chain_runs_from_the_starting_process_up_to_init() {
        let table: HashMap<u32, u32> = [(9, 8), (8, 7), (7, 1)].into_iter().collect();
        let parent = |pid: u32| table.get(&pid).copied();
        assert_eq!(ancestor_pids(9, 8, &parent), vec![9, 8, 7]);
    }

    #[test]
    fn the_chain_stops_after_the_hop_limit() {
        let parent = |pid: u32| Some(pid + 1);
        assert_eq!(ancestor_pids(10, 3, &parent), vec![10, 11, 12]);
    }

    /// A table read while processes come and go can describe a loop.
    #[test]
    fn a_loop_in_the_table_does_not_spin() {
        let table: HashMap<u32, u32> = [(9, 8), (8, 9)].into_iter().collect();
        let parent = |pid: u32| table.get(&pid).copied();
        assert_eq!(ancestor_pids(9, 8, &parent), vec![9, 8]);
    }

    #[test]
    fn init_itself_has_no_chain() {
        assert_eq!(ancestor_pids(1, 8, &|_| None), Vec::<u32>::new());
    }

    #[test]
    fn transcripts_come_back_newest_first() {
        let root = scratch();
        let dirs = dirs_in(&root);
        let older = write_log(&dirs, "/w", "aaa", "{}");
        let newer = write_log(&dirs, "/w", "bbb", "{}");
        age(&older, 600);
        age(&newer, 60);
        assert_eq!(find_session_logs_for_cwd("/w", &dirs.projects), vec![newer, older]);
    }

    #[test]
    fn a_project_nobody_has_a_session_for_has_no_transcripts() {
        let root = scratch();
        let dirs = dirs_in(&root);
        assert!(find_session_logs_for_cwd("/nowhere", &dirs.projects).is_empty());
    }

    /// The one tier that identifies *this* session rather than a likely one.
    #[test]
    fn the_session_of_an_ancestor_process_wins() {
        let root = scratch();
        let dirs = dirs_in(&root);
        let mine = write_log(&dirs, "/w", "mine", "{}");
        let theirs = write_log(&dirs, "/w", "theirs", "{}");
        age(&mine, 600);
        age(&theirs, 60);
        // Registered by another process, so it is a real concurrent session
        // and must not be mistaken for the one `/clear` just made.
        write_meta(&dirs, 100, "theirs", "/w", 2);
        write_meta(&dirs, 42, "mine", "/w", 1);

        let table: HashMap<u32, u32> = [(9, 8), (8, 42)].into_iter().collect();
        let parent = |pid: u32| table.get(&pid).copied();
        assert_eq!(
            resolve_by_ancestor_pids(9, &dirs, &parent),
            Some(mine),
            "the newest transcript is {theirs:?}, but it belongs to someone else"
        );
    }

    /// What `/clear` leaves: a new transcript that no metadata file names.
    #[test]
    fn a_newer_transcript_nobody_claims_is_the_session_that_clear_started() {
        let root = scratch();
        let dirs = dirs_in(&root);
        let old = write_log(&dirs, "/w", "old", "{}");
        let ghost = write_log(&dirs, "/w", "ghost", "{}");
        age(&old, 600);
        age(&ghost, 60);
        write_meta(&dirs, 42, "old", "/w", 1);

        let parent = |_: u32| None;
        assert_eq!(resolve_by_ancestor_pids(42, &dirs, &parent), Some(ghost));
    }

    #[test]
    fn without_a_matching_process_the_newest_started_session_for_this_cwd_is_used() {
        let root = scratch();
        let dirs = dirs_in(&root);
        write_log(&dirs, "/w", "older", "{}");
        let newer = write_log(&dirs, "/w", "newer", "{}");
        write_meta(&dirs, 1, "older", "/w", 100);
        write_meta(&dirs, 2, "newer", "/w", 200);
        // Another project's session, which must not be picked up.
        write_meta(&dirs, 3, "elsewhere", "/other", 300);

        assert_eq!(resolve_by_cwd_scan("/w", &dirs), Some(newer));
    }

    #[test]
    fn a_deeper_directory_falls_back_to_the_project_it_is_inside() {
        let root = scratch();
        let dirs = dirs_in(&root);
        let log = write_log(&dirs, "/w", "aaa", "{}");
        assert_eq!(
            find_logs_by_ancestor_walk(Path::new("/w/src/deep"), &dirs.projects),
            vec![log]
        );
    }

    #[test]
    fn every_tier_is_offered_once_best_first() {
        let root = scratch();
        let dirs = dirs_in(&root);
        let mine = write_log(&dirs, "/w", "mine", "{}");
        let other = write_log(&dirs, "/w", "other", "{}");
        age(&mine, 600);
        age(&other, 60);
        write_meta(&dirs, 42, "mine", "/w", 1);
        write_meta(&dirs, 43, "other", "/w", 2);

        let parent = |_: u32| None;
        let candidates = transcript_candidates(Path::new("/w"), 42, &dirs, &parent);
        // Tier 1 names `mine`; the mtime tier would have led with `other`.
        assert_eq!(candidates, vec![mine, other]);
    }

    #[test]
    fn a_directory_with_no_session_anywhere_above_it_offers_nothing() {
        let root = scratch();
        let dirs = dirs_in(&root);
        let parent = |_: u32| None;
        assert!(transcript_candidates(Path::new("/nowhere/at/all"), 42, &dirs, &parent).is_empty());
    }
}
