//! Reading the command line. Nothing but the arguments goes in, so every rule
//! below is a rule a test can state.
//!
//! Two of the shapes here are inherited from the shell script this replaces and
//! kept on purpose. `--help` and `--version` are only recognised as the *first*
//! argument, so `mdnotate a.md --version` opens a file with an odd name rather
//! than printing a version and ignoring the file. And option scanning stops at
//! the first thing that is not an option, instead of being rearranged the way
//! getopt would: `mdnotate a.md -h host` is three files.

/// What was asked for. Whether piped input turns `FocusApp` into a document is
/// not decided here — that needs to look at stdin, which is `dispatch`'s to do.
#[derive(Debug, PartialEq, Eq)]
pub enum Mode {
    ShowHelp,
    ShowVersion,
    /// Nothing to open: bring the app to the front.
    FocusApp,
    Open {
        host: Option<String>,
        files: Vec<String>,
    },
    Last {
        host: Option<String>,
    },
}

/// `-h` is the host, not help. The old habit has to land somewhere that points
/// at the new spelling.
const HELP_HINT: &str = "try 'mdnotate --help'";

pub fn parse(args: &[String]) -> Result<Mode, String> {
    match args.first().map(String::as_str) {
        None => return Ok(Mode::FocusApp),
        Some("--help") => return Ok(Mode::ShowHelp),
        Some("-v" | "--version") => return Ok(Mode::ShowVersion),
        Some("last") => return parse_last(&args[1..]),
        _ => {}
    }

    let mut host = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            // The usual way to say "everything after this is a filename", which
            // is the only way to name a file that starts with a dash.
            "--" => {
                i += 1;
                break;
            }
            "-h" | "--host" => {
                host = Some(args.get(i + 1).cloned().ok_or_else(missing_host)?);
                i += 2;
            }
            arg if arg.starts_with('-') => {
                return Err(format!("unrecognized option '{arg}' — {HELP_HINT}"))
            }
            // The first thing that is not an option ends the scan.
            _ => break,
        }
    }

    let files = args[i..].to_vec();
    if host.is_none() && files.is_empty() {
        return Ok(Mode::FocusApp);
    }
    Ok(Mode::Open { host, files })
}

/// `last` names its own document, so it takes no files — being handed one means
/// a misunderstanding worth saying out loud rather than quietly dropping.
fn parse_last(rest: &[String]) -> Result<Mode, String> {
    let mut host = None;
    let mut i = 0;
    while i < rest.len() {
        match rest[i].as_str() {
            "-h" | "--host" => {
                host = Some(rest.get(i + 1).cloned().ok_or_else(missing_host)?);
                i += 2;
            }
            arg if arg.starts_with('-') => {
                return Err(format!("unrecognized option '{arg}' — {HELP_HINT}"))
            }
            _ => return Err("last takes no file arguments".to_string()),
        }
    }
    Ok(Mode::Last { host })
}

fn missing_host() -> String {
    format!("-h/--host requires an argument — {HELP_HINT}")
}

pub const USAGE: &str = "\
Usage: mdnotate [file ...]
       mdnotate <host>:<path>
       mdnotate <mdnotate:// link>
       mdnotate -h <host> <file ...>
       mdnotate last [-h <host>]
       <something> | mdnotate [-h <host>]

Opens documents in mdnotate, starting it if it is not already running. With no
arguments and nothing piped in, it brings the app to the front.

  file              A local path, absolute or relative to the current directory
  <host>:<path>     A file on another machine, read over ssh. `host` is an alias
                    from ~/.ssh/config; the path is relative to the remote home
                    unless it starts with a slash. Quote it if it contains a `~`,
                    or the shell will expand that here rather than there.
  mdnotate:// link  Opened as it stands

Anything piped in is written to a file under /tmp/mdnotate and opened, so
`pbpaste | mdnotate` reads what was last copied. Piped input that is empty is
treated as none at all.

  -h, --host HOST   Send the files, or the piped input, to HOST over ssh and
                    open them in the mdnotate running there. They land in
                    /tmp/mdnotate/<this machine>/. HOST needs the mdnotate
                    command on its own PATH; /usr/local/bin and ~/.local/bin
                    are looked in whether or not the login shell would. Only
                    local files can be sent — a <host>:<path> or a link is
                    refused rather than pushed somewhere unexpected.
      --help        Show this
  -v, --version     Show the version of the app this command belongs to
      --            Everything after this is a file, even if it starts with -

Subcommands:
  last              Open the last thing Claude Code said in this directory's
                    session, as a Markdown document. Takes -h/--host too.
";

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_args(args: &[&str]) -> Result<Mode, String> {
        parse(&args.iter().map(|a| a.to_string()).collect::<Vec<_>>())
    }

    fn files(args: &[&str]) -> Vec<String> {
        args.iter().map(|a| a.to_string()).collect()
    }

    #[test]
    fn nothing_at_all_brings_the_app_to_the_front() {
        assert_eq!(parse_args(&[]), Ok(Mode::FocusApp));
    }

    #[test]
    fn a_lone_dash_dash_is_still_nothing_to_open() {
        assert_eq!(parse_args(&["--"]), Ok(Mode::FocusApp));
    }

    #[test]
    fn help_and_version_answer_instead_of_opening_anything() {
        assert_eq!(parse_args(&["--help"]), Ok(Mode::ShowHelp));
        assert_eq!(parse_args(&["-v"]), Ok(Mode::ShowVersion));
        assert_eq!(parse_args(&["--version"]), Ok(Mode::ShowVersion));
    }

    /// The shell script's quirk, kept: only the first argument is read as an
    /// option, so this opens a file that happens to be called `--version`.
    #[test]
    fn version_after_a_file_is_a_filename() {
        assert_eq!(
            parse_args(&["a.md", "--version"]),
            Ok(Mode::Open {
                host: None,
                files: files(&["a.md", "--version"])
            })
        );
    }

    #[test]
    fn files_are_collected_in_the_order_they_were_given() {
        assert_eq!(
            parse_args(&["a.md", "b.log"]),
            Ok(Mode::Open {
                host: None,
                files: files(&["a.md", "b.log"])
            })
        );
    }

    #[test]
    fn after_dash_dash_a_leading_dash_is_part_of_the_name() {
        assert_eq!(
            parse_args(&["--", "-dashed.md"]),
            Ok(Mode::Open {
                host: None,
                files: files(&["-dashed.md"])
            })
        );
    }

    #[test]
    fn a_host_can_be_given_either_way_round() {
        for flag in ["-h", "--host"] {
            assert_eq!(
                parse_args(&[flag, "maiev.ts", "a.md"]),
                Ok(Mode::Open {
                    host: Some("maiev.ts".to_string()),
                    files: files(&["a.md"])
                })
            );
        }
    }

    /// A host with no files is not the same as no arguments: something is meant
    /// to be sent, and `dispatch` is the one that finds out whether stdin has
    /// it.
    #[test]
    fn a_host_on_its_own_is_not_a_request_to_focus() {
        assert_eq!(
            parse_args(&["-h", "maiev.ts"]),
            Ok(Mode::Open {
                host: Some("maiev.ts".to_string()),
                files: vec![]
            })
        );
    }

    #[test]
    fn a_host_flag_with_nothing_after_it_says_so() {
        let err = parse_args(&["-h"]).unwrap_err();
        assert!(err.starts_with("-h/--host requires an argument"), "{err}");
        // The old habit of typing `-h` for help has to find its way home.
        assert!(err.contains("--help"), "{err}");
    }

    #[test]
    fn an_option_nobody_knows_is_refused() {
        let err = parse_args(&["--nonsense"]).unwrap_err();
        assert!(err.contains("unrecognized option '--nonsense'"), "{err}");
        assert!(err.contains("--help"), "{err}");
    }

    /// As in the shell script, where `case "$1"` was the whole of it.
    #[test]
    fn a_lone_dash_is_an_option_nobody_knows() {
        assert!(parse_args(&["-"]).is_err());
    }

    /// Not rearranged the way getopt would: the first file ends the scan, so
    /// everything after it is a file too.
    #[test]
    fn options_after_the_first_file_are_filenames() {
        assert_eq!(
            parse_args(&["a.md", "-h", "maiev.ts"]),
            Ok(Mode::Open {
                host: None,
                files: files(&["a.md", "-h", "maiev.ts"])
            })
        );
    }

    #[test]
    fn last_on_its_own_is_the_local_one() {
        assert_eq!(parse_args(&["last"]), Ok(Mode::Last { host: None }));
    }

    #[test]
    fn last_takes_a_host_like_everything_else() {
        for flag in ["-h", "--host"] {
            assert_eq!(
                parse_args(&["last", flag, "maiev.ts"]),
                Ok(Mode::Last {
                    host: Some("maiev.ts".to_string())
                })
            );
        }
    }

    #[test]
    fn last_names_its_own_document_and_takes_no_other() {
        assert_eq!(
            parse_args(&["last", "extra.md"]),
            Err("last takes no file arguments".to_string())
        );
    }

    #[test]
    fn last_refuses_an_option_nobody_knows_too() {
        assert!(parse_args(&["last", "--nope"]).is_err());
    }

    #[test]
    fn last_with_a_host_flag_and_nothing_after_it_says_so() {
        assert!(parse_args(&["last", "--host"])
            .unwrap_err()
            .starts_with("-h/--host requires an argument"));
    }

    /// `last` is only a subcommand where a subcommand can be: elsewhere it is
    /// the name of a file, which is what someone with a file called `last`
    /// would expect.
    #[test]
    fn last_after_a_file_is_a_filename() {
        assert_eq!(
            parse_args(&["a.md", "last"]),
            Ok(Mode::Open {
                host: None,
                files: files(&["a.md", "last"])
            })
        );
    }
}
