//! What each parsed command actually does. The one place that decides, and the
//! one place that has to be read to know what this command does at all.
//!
//! Everything with an effect goes through `System`, so the tests below are the
//! behaviour table itself: they say which external commands run, in what order,
//! and — as often the point — which ones do not.

use std::collections::HashSet;
use std::path::Path;

use crate::cli::{parse, Mode, USAGE};
use crate::locator::{self, Kind};
use crate::system::System;
use crate::transcript;
use crate::{paths, remote};

/// What `main` prints and exits with. Collected rather than written out as it
/// goes, so that a test can read it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    pub code: i32,
    pub out: String,
    pub err: String,
}

impl Outcome {
    fn done() -> Self {
        Self::default()
    }

    fn says(text: &str) -> Self {
        Self {
            code: 0,
            out: text.to_string(),
            err: String::new(),
        }
    }

    fn failed(message: &str) -> Self {
        Self {
            code: 1,
            out: String::new(),
            err: format!("mdnotate: {message}\n"),
        }
    }

    /// Note a failure and carry on. Several files are opened or sent in one
    /// call, and one of them going wrong is no reason to abandon the rest —
    /// the exit code at the end says something did.
    fn absorb(&mut self, result: Result<(), String>) {
        if let Err(message) = result {
            self.code = 1;
            self.err.push_str(&format!("mdnotate: {message}\n"));
        }
    }
}

pub fn run(args: &[String], sys: &dyn System) -> Outcome {
    let mode = match parse(args) {
        Ok(mode) => mode,
        Err(message) => return Outcome::failed(&message),
    };
    match dispatch(mode, sys) {
        Ok(outcome) => outcome,
        Err(message) => Outcome::failed(&message),
    }
}

fn dispatch(mode: Mode, sys: &dyn System) -> Result<Outcome, String> {
    match mode {
        Mode::ShowHelp => Ok(Outcome::says(USAGE)),
        Mode::ShowVersion => {
            let app = sys.app_bundle()?;
            Ok(Outcome::says(&format!("mdnotate {}\n", sys.app_version(&app)?)))
        }
        Mode::FocusApp => focus_or_piped_input(sys),
        Mode::Open { host: None, files } => open_here(&files, sys),
        Mode::Open {
            host: Some(host),
            files,
        } => push(&host, &files, sys),
        Mode::Last { host } => last(host.as_deref(), sys),
    }
}

/// Nothing named, so either something was piped in or the app is simply wanted
/// in front.
fn focus_or_piped_input(sys: &dyn System) -> Result<Outcome, String> {
    let app = sys.app_bundle()?;
    let Some(content) = piped_input(sys)? else {
        sys.focus_app(&app)?;
        return Ok(Outcome::done());
    };
    let path = paths::local_content_path(paths::CLIPBOARD, &stamp(sys));
    sys.write_file(&path, &content)?;
    sys.open_files(&app, &[path.to_string_lossy().into_owned()])?;
    Ok(Outcome::done())
}

/// What was piped in, if anything was.
///
/// Empty input counts as none: a command run from cron or with its input
/// redirected from nowhere should bring the app up rather than fail, and an
/// empty document is not worth opening either way.
fn piped_input(sys: &dyn System) -> Result<Option<Vec<u8>>, String> {
    if sys.stdin_is_tty() {
        return Ok(None);
    }
    let content = sys.read_stdin()?;
    if content.iter().all(u8::is_ascii_whitespace) {
        return Ok(None);
    }
    Ok(Some(content))
}

/// Open on this machine. Local files are collected up and opened in one go;
/// anything naming another machine is wrapped into a link as it is reached,
/// because that grammar is the app's to read and `open` would only look for a
/// file by that name.
fn open_here(files: &[String], sys: &dyn System) -> Result<Outcome, String> {
    let app = sys.app_bundle()?;
    let mut local = Vec::new();
    let mut outcome = Outcome::done();
    for arg in files {
        match locator::classify(arg) {
            Kind::Link => outcome.absorb(sys.open_link(arg)),
            Kind::Remote => outcome.absorb(sys.open_link(&locator::link_for(arg))),
            Kind::Local => local.push(arg.clone()),
        }
    }
    if !local.is_empty() {
        outcome.absorb(sys.open_files(&app, &local));
    }
    Ok(outcome)
}

/// Send to another machine and open it there.
///
/// Local files only: a `host:path` would mean a third machine and a link would
/// mean whatever the far end makes of it, and neither is something to guess at
/// after the bytes have already gone.
fn push(host: &str, files: &[String], sys: &dyn System) -> Result<Outcome, String> {
    if let Some(arg) = files
        .iter()
        .find(|arg| locator::classify(arg) != Kind::Local)
    {
        return Err(format!(
            "-h/--host sends local files only — '{arg}' names somewhere else"
        ));
    }
    let host_id = remote::sanitize_host_id(&sys.host_id());

    if files.is_empty() {
        let Some(content) = piped_input(sys)? else {
            return Err("-h/--host needs a file, or something piped in".to_string());
        };
        let dir = paths::remote_content_dir(&host_id, paths::CLIPBOARD);
        let path = format!("{dir}/{}.md", stamp(sys));
        sys.push_and_launch(host, &dir, &path, &content)?;
        return Ok(Outcome::done());
    }

    // Sent under their own names, so that sending the same file again lands on
    // the same path and the app over there refreshes the window already showing
    // it instead of opening a second one.
    let dir = paths::remote_dir(&host_id);
    let mut taken = HashSet::new();
    let mut outcome = Outcome::done();
    for arg in files {
        let name = remote::dedup_remote_name(&remote::remote_name(arg), &mut taken);
        let path = format!("{dir}/{name}");
        outcome.absorb(
            sys.read_file(Path::new(arg))
                .and_then(|content| sys.push_and_launch(host, &dir, &path, &content)),
        );
    }
    Ok(outcome)
}

/// The last thing Claude Code said in this directory's session.
///
/// The candidates are read in order until one has a reply in it: a transcript
/// found is not a transcript with anything in it, and the two ways of coming up
/// empty need different words — one means we are looking in the wrong place,
/// the other that there is nothing to look at yet.
fn last(host: Option<&str>, sys: &dyn System) -> Result<Outcome, String> {
    let cwd = sys.cwd()?;
    let candidates = sys.find_transcripts(&cwd);
    if candidates.is_empty() {
        return Err("could not find a Claude Code session for this directory".to_string());
    }
    let text = candidates
        .iter()
        .filter_map(|path| sys.read_file(path).ok())
        .find_map(|raw| {
            transcript::get_last_rendered_message(&String::from_utf8_lossy(&raw))
                .map(|message| message.text)
        })
        .ok_or("no assistant reply found in the current session yet")?;

    match host {
        Some(host) => {
            let host_id = remote::sanitize_host_id(&sys.host_id());
            let dir = paths::remote_content_dir(&host_id, paths::LAST);
            let path = format!("{dir}/{}.md", stamp(sys));
            sys.push_and_launch(host, &dir, &path, text.as_bytes())?;
        }
        None => {
            let app = sys.app_bundle()?;
            let path = paths::local_content_path(paths::LAST, &stamp(sys));
            sys.write_file(&path, text.as_bytes())?;
            sys.open_files(&app, &[path.to_string_lossy().into_owned()])?;
        }
    }
    Ok(Outcome::done())
}

fn stamp(sys: &dyn System) -> String {
    paths::stamp(&sys.timestamp(), sys.pid())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;

    const APP: &str = "/Applications/mdnotate.app";
    /// What `FakeSystem` always says the clock and the process say, so that the
    /// generated paths below can be written out in full.
    const STAMP: &str = "20260818-101530-4242";

    /// One thing done to the world outside, as it will be asserted on.
    #[derive(Debug, PartialEq, Eq)]
    enum Call {
        OpenFiles(Vec<String>),
        OpenLink(String),
        Focus,
        Write(String, String),
        Push {
            host: String,
            dir: String,
            path: String,
            content: String,
        },
    }

    #[derive(Default)]
    struct FakeSystem {
        calls: RefCell<Vec<Call>>,
        stdin: Option<Vec<u8>>,
        /// What each named file contains. Anything else is unreadable.
        files: Vec<(String, String)>,
        transcripts: Vec<PathBuf>,
    }

    impl FakeSystem {
        /// Nothing piped in — a command typed at a terminal.
        fn tty() -> Self {
            Self::default()
        }

        fn piped(input: &str) -> Self {
            Self {
                stdin: Some(input.as_bytes().to_vec()),
                ..Self::default()
            }
        }

        fn with_file(mut self, path: &str, content: &str) -> Self {
            self.files.push((path.to_string(), content.to_string()));
            self
        }

        fn with_transcript(mut self, path: &str, body: &str) -> Self {
            self.transcripts.push(PathBuf::from(path));
            self.files.push((path.to_string(), body.to_string()));
            self
        }

        fn calls(&self) -> std::cell::Ref<'_, Vec<Call>> {
            self.calls.borrow()
        }

        fn note(&self, call: Call) -> Result<(), String> {
            self.calls.borrow_mut().push(call);
            Ok(())
        }
    }

    impl System for FakeSystem {
        fn app_bundle(&self) -> Result<PathBuf, String> {
            Ok(PathBuf::from(APP))
        }
        fn app_version(&self, _app: &Path) -> Result<String, String> {
            Ok("0.6.0".to_string())
        }
        fn open_files(&self, app: &Path, files: &[String]) -> Result<(), String> {
            assert_eq!(app, Path::new(APP));
            self.note(Call::OpenFiles(files.to_vec()))
        }
        fn open_link(&self, link: &str) -> Result<(), String> {
            self.note(Call::OpenLink(link.to_string()))
        }
        fn focus_app(&self, _app: &Path) -> Result<(), String> {
            self.note(Call::Focus)
        }
        fn stdin_is_tty(&self) -> bool {
            self.stdin.is_none()
        }
        fn read_stdin(&self) -> Result<Vec<u8>, String> {
            Ok(self.stdin.clone().unwrap_or_default())
        }
        fn read_file(&self, path: &Path) -> Result<Vec<u8>, String> {
            let wanted = path.to_string_lossy();
            self.files
                .iter()
                .find(|(name, _)| *name == wanted)
                .map(|(_, content)| content.as_bytes().to_vec())
                .ok_or_else(|| format!("could not read {wanted} — no such file"))
        }
        fn write_file(&self, path: &Path, bytes: &[u8]) -> Result<(), String> {
            self.note(Call::Write(
                path.to_string_lossy().into_owned(),
                String::from_utf8_lossy(bytes).into_owned(),
            ))
        }
        fn cwd(&self) -> Result<PathBuf, String> {
            Ok(PathBuf::from("/w"))
        }
        fn timestamp(&self) -> String {
            "20260818-101530".to_string()
        }
        fn pid(&self) -> u32 {
            4242
        }
        fn host_id(&self) -> String {
            "mbp\n".to_string()
        }
        fn push_and_launch(
            &self,
            host: &str,
            remote_dir: &str,
            remote_path: &str,
            content: &[u8],
        ) -> Result<(), String> {
            self.note(Call::Push {
                host: host.to_string(),
                dir: remote_dir.to_string(),
                path: remote_path.to_string(),
                content: String::from_utf8_lossy(content).into_owned(),
            })
        }
        fn find_transcripts(&self, _cwd: &Path) -> Vec<PathBuf> {
            self.transcripts.clone()
        }
    }

    fn go(args: &[&str], sys: &FakeSystem) -> Outcome {
        run(&args.iter().map(|a| a.to_string()).collect::<Vec<_>>(), sys)
    }

    fn opened(files: &[&str]) -> Call {
        Call::OpenFiles(files.iter().map(|f| f.to_string()).collect())
    }

    /// One assistant reply, as a whole transcript.
    fn transcript_saying(text: &str) -> String {
        format!(
            r#"{{"type":"assistant","uuid":"a1","parentUuid":null,"message":{{"id":"m1","role":"assistant","content":[{{"type":"text","text":"{text}"}}]}}}}"#
        )
    }

    // --- opening on this machine ---------------------------------------------

    #[test]
    fn nothing_at_all_brings_the_app_to_the_front() {
        let sys = FakeSystem::tty();
        assert_eq!(go(&[], &sys).code, 0);
        assert_eq!(*sys.calls(), vec![Call::Focus]);
    }

    #[test]
    fn a_lone_dash_dash_is_still_nothing_to_open() {
        let sys = FakeSystem::tty();
        go(&["--"], &sys);
        assert_eq!(*sys.calls(), vec![Call::Focus]);
    }

    /// One call, not one per file, so that they arrive together and are routed
    /// together.
    #[test]
    fn files_are_opened_in_a_single_call() {
        let sys = FakeSystem::tty();
        assert_eq!(go(&["a.md", "b.log"], &sys).code, 0);
        assert_eq!(*sys.calls(), vec![opened(&["a.md", "b.log"])]);
    }

    #[test]
    fn a_file_named_after_an_option_opens_once_it_is_behind_dash_dash() {
        let sys = FakeSystem::tty();
        go(&["--", "-dashed.md"], &sys);
        assert_eq!(*sys.calls(), vec![opened(&["-dashed.md"])]);
    }

    #[test]
    fn a_remote_path_goes_as_a_link_because_open_would_look_for_a_file() {
        let sys = FakeSystem::tty();
        go(&["h:Sync/a.md"], &sys);
        assert_eq!(
            *sys.calls(),
            vec![Call::OpenLink(
                "mdnotate://open?path=h%3ASync%2Fa.md".to_string()
            )]
        );
    }

    /// Already a link, so it is passed on whole rather than wrapped in a second
    /// one, which would bury it in its own `path` parameter.
    #[test]
    fn a_link_is_handed_over_exactly_as_it_was_given() {
        let sys = FakeSystem::tty();
        go(&["mdnotate://open?path=%2Fa.md"], &sys);
        assert_eq!(
            *sys.calls(),
            vec![Call::OpenLink("mdnotate://open?path=%2Fa.md".to_string())]
        );
    }

    /// Links go as they are reached, files all at the end — the shell script's
    /// order, kept.
    #[test]
    fn links_go_first_and_files_go_together_at_the_end() {
        let sys = FakeSystem::tty();
        go(&["h:a.md", "notes.md"], &sys);
        assert_eq!(
            *sys.calls(),
            vec![
                Call::OpenLink("mdnotate://open?path=h%3Aa.md".to_string()),
                opened(&["notes.md"]),
            ]
        );
    }

    #[test]
    fn the_version_comes_off_the_bundle_this_command_belongs_to() {
        let sys = FakeSystem::tty();
        let outcome = go(&["--version"], &sys);
        assert_eq!(outcome.out, "mdnotate 0.6.0\n");
        assert_eq!(outcome.code, 0);
        assert!(sys.calls().is_empty());
    }

    #[test]
    fn help_opens_nothing() {
        let sys = FakeSystem::tty();
        let outcome = go(&["--help"], &sys);
        assert!(outcome.out.starts_with("Usage: mdnotate"));
        assert_eq!(outcome.code, 0);
        assert!(sys.calls().is_empty());
    }

    #[test]
    fn an_option_nobody_knows_says_so_and_opens_nothing() {
        let sys = FakeSystem::tty();
        let outcome = go(&["--nonsense"], &sys);
        assert_eq!(outcome.code, 1);
        assert!(outcome.err.contains("unrecognized option"), "{}", outcome.err);
        assert!(sys.calls().is_empty());
    }

    // --- piped input ---------------------------------------------------------

    #[test]
    fn piped_input_becomes_a_document_and_is_opened() {
        let sys = FakeSystem::piped("# from the clipboard");
        assert_eq!(go(&[], &sys).code, 0);
        let path = format!("/tmp/mdnotate/local/clipboard/{STAMP}.md");
        assert_eq!(
            *sys.calls(),
            vec![
                Call::Write(path.clone(), "# from the clipboard".to_string()),
                opened(&[&path]),
            ]
        );
    }

    /// Input redirected from nowhere should bring the app up, not fail.
    #[test]
    fn empty_piped_input_is_the_same_as_none() {
        let sys = FakeSystem::piped("");
        go(&[], &sys);
        assert_eq!(*sys.calls(), vec![Call::Focus]);

        let blank = FakeSystem::piped("  \n\n");
        go(&[], &blank);
        assert_eq!(*blank.calls(), vec![Call::Focus]);
    }

    /// Named files are what was asked for; whatever is on stdin is not.
    #[test]
    fn piped_input_is_ignored_when_files_were_named() {
        let sys = FakeSystem::piped("ignored");
        go(&["a.md"], &sys);
        assert_eq!(*sys.calls(), vec![opened(&["a.md"])]);
    }

    // --- sending to another machine ------------------------------------------

    #[test]
    fn a_file_is_sent_under_its_own_name_below_this_machines_own_directory() {
        let sys = FakeSystem::tty().with_file("report.md", "the report");
        assert_eq!(go(&["-h", "maiev.ts", "report.md"], &sys).code, 0);
        assert_eq!(
            *sys.calls(),
            vec![Call::Push {
                host: "maiev.ts".to_string(),
                dir: "/tmp/mdnotate/mbp".to_string(),
                path: "/tmp/mdnotate/mbp/report.md".to_string(),
                content: "the report".to_string(),
            }]
        );
    }

    /// Nothing is written here on the way: the bytes go from the file into the
    /// connection.
    #[test]
    fn sending_a_file_leaves_nothing_behind_on_this_machine() {
        let sys = FakeSystem::tty().with_file("report.md", "the report");
        go(&["-h", "maiev.ts", "report.md"], &sys);
        assert!(
            !sys.calls().iter().any(|c| matches!(c, Call::Write(..))),
            "{:?}",
            sys.calls()
        );
    }

    #[test]
    fn two_files_of_the_same_name_do_not_become_one() {
        let sys = FakeSystem::tty()
            .with_file("a/notes.md", "first")
            .with_file("b/notes.md", "second");
        go(&["-h", "maiev.ts", "a/notes.md", "b/notes.md"], &sys);
        let paths: Vec<String> = sys
            .calls()
            .iter()
            .filter_map(|call| match call {
                Call::Push { path, .. } => Some(path.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(
            paths,
            vec![
                "/tmp/mdnotate/mbp/notes.md".to_string(),
                "/tmp/mdnotate/mbp/notes-2.md".to_string(),
            ]
        );
    }

    #[test]
    fn one_file_that_cannot_be_read_does_not_stop_the_others() {
        let sys = FakeSystem::tty().with_file("there.md", "here");
        let outcome = go(&["-h", "maiev.ts", "missing.md", "there.md"], &sys);
        assert_eq!(outcome.code, 1);
        assert!(outcome.err.contains("missing.md"), "{}", outcome.err);
        assert_eq!(sys.calls().len(), 1, "{:?}", sys.calls());
    }

    #[test]
    fn piped_input_can_be_sent_too() {
        let sys = FakeSystem::piped("copied text");
        assert_eq!(go(&["-h", "maiev.ts"], &sys).code, 0);
        assert_eq!(
            *sys.calls(),
            vec![Call::Push {
                host: "maiev.ts".to_string(),
                dir: "/tmp/mdnotate/mbp/clipboard".to_string(),
                path: format!("/tmp/mdnotate/mbp/clipboard/{STAMP}.md"),
                content: "copied text".to_string(),
            }]
        );
    }

    #[test]
    fn a_host_with_nothing_to_send_says_what_is_missing() {
        let sys = FakeSystem::tty();
        let outcome = go(&["-h", "maiev.ts"], &sys);
        assert_eq!(outcome.code, 1);
        assert!(outcome.err.contains("needs a file"), "{}", outcome.err);
        assert!(sys.calls().is_empty());
    }

    /// Refused before a byte goes over the wire — a third machine is not
    /// something to guess at afterwards.
    #[test]
    fn a_path_naming_a_third_machine_is_refused_before_anything_is_sent() {
        let sys = FakeSystem::tty().with_file("other:x.md", "unused");
        let outcome = go(&["-h", "maiev.ts", "other:x.md"], &sys);
        assert_eq!(outcome.code, 1);
        assert!(outcome.err.contains("local files only"), "{}", outcome.err);
        assert!(sys.calls().is_empty());
    }

    #[test]
    fn a_link_is_refused_the_same_way() {
        let sys = FakeSystem::tty();
        let outcome = go(&["-h", "maiev.ts", "mdnotate://open?path=%2Fa.md"], &sys);
        assert_eq!(outcome.code, 1);
        assert!(sys.calls().is_empty());
    }

    /// One bad argument stops the whole call, including the good files beside
    /// it: half a push is harder to reason about than none.
    #[test]
    fn a_refused_argument_stops_the_files_beside_it_too() {
        let sys = FakeSystem::tty().with_file("fine.md", "fine");
        go(&["-h", "maiev.ts", "fine.md", "other:x.md"], &sys);
        assert!(sys.calls().is_empty());
    }

    #[test]
    fn a_host_flag_with_nothing_after_it_sends_nothing() {
        let sys = FakeSystem::tty();
        let outcome = go(&["-h"], &sys);
        assert_eq!(outcome.code, 1);
        assert!(sys.calls().is_empty());
    }

    // --- the last message ----------------------------------------------------

    #[test]
    fn the_last_reply_becomes_a_document_and_is_opened() {
        let sys =
            FakeSystem::tty().with_transcript("/t/one.jsonl", &transcript_saying("the reply"));
        assert_eq!(go(&["last"], &sys).code, 0);
        let path = format!("/tmp/mdnotate/local/last/{STAMP}.md");
        assert_eq!(
            *sys.calls(),
            vec![
                Call::Write(path.clone(), "the reply".to_string()),
                opened(&[&path]),
            ]
        );
    }

    #[test]
    fn the_last_reply_can_be_sent_to_another_machine_instead() {
        let sys =
            FakeSystem::tty().with_transcript("/t/one.jsonl", &transcript_saying("the reply"));
        assert_eq!(go(&["last", "--host", "maiev.ts"], &sys).code, 0);
        assert_eq!(
            *sys.calls(),
            vec![Call::Push {
                host: "maiev.ts".to_string(),
                dir: "/tmp/mdnotate/mbp/last".to_string(),
                path: format!("/tmp/mdnotate/mbp/last/{STAMP}.md"),
                content: "the reply".to_string(),
            }]
        );
        // Sent, not written here first.
        assert!(!sys.calls().iter().any(|c| matches!(c, Call::Write(..))));
    }

    /// The two ways of coming up empty need different words: one means we are
    /// looking in the wrong place, the other that there is nothing yet.
    #[test]
    fn no_session_at_all_says_so() {
        let sys = FakeSystem::tty();
        let outcome = go(&["last"], &sys);
        assert_eq!(outcome.code, 1);
        assert!(outcome.err.contains("could not find"), "{}", outcome.err);
        assert!(sys.calls().is_empty());
    }

    #[test]
    fn a_session_with_no_reply_in_it_yet_says_something_else() {
        let sys = FakeSystem::tty().with_transcript(
            "/t/one.jsonl",
            r#"{"type":"user","uuid":"u1","parentUuid":null,"message":{"role":"user","content":"hello"}}"#,
        );
        let outcome = go(&["last"], &sys);
        assert_eq!(outcome.code, 1);
        assert!(outcome.err.contains("no assistant reply"), "{}", outcome.err);
        assert!(sys.calls().is_empty());
    }

    /// A transcript found is not a transcript with anything in it, so the list
    /// is read down until one has a reply.
    #[test]
    fn a_transcript_with_nothing_in_it_falls_through_to_the_next_candidate() {
        let sys = FakeSystem::tty()
            .with_transcript("/t/empty.jsonl", "")
            .with_transcript("/t/two.jsonl", &transcript_saying("the reply"));
        assert_eq!(go(&["last"], &sys).code, 0);
        assert!(sys
            .calls()
            .iter()
            .any(|c| matches!(c, Call::Write(_, text) if text == "the reply")));
    }

    #[test]
    fn last_takes_no_files_and_opens_nothing_when_given_one() {
        let sys = FakeSystem::tty();
        let outcome = go(&["last", "extra.md"], &sys);
        assert_eq!(outcome.code, 1);
        assert!(outcome.err.contains("no file arguments"), "{}", outcome.err);
        assert!(sys.calls().is_empty());
    }
}
