//! The `mdnotate` command.
//!
//! This is never run from where it sits. It is reached through a symlink
//! dropped somewhere on PATH — the shape VS Code's `code` has — so its first
//! job is to find its way back through that link to the .app it belongs to, and
//! its second is to hand what it was given to `open`. Everything after that is
//! the app's own, long since settled: LaunchServices starts it if it is not
//! running and delivers to it if it is, both arriving as
//! `application:openURLs:`, which is the same door a double-click in Finder
//! comes in by. Which window each document lands in is `choose_target`'s to
//! say, exactly as it is for a double-click.
//!
//! Two things it does that are not opening a file — sending a document to
//! another machine over ssh, and reading the last message out of a Claude Code
//! transcript — are why this stopped being a shell script.

mod cli;
mod dispatch;
mod locator;
mod paths;
mod quote;
mod remote;
mod session_discovery;
mod system;
mod transcript;

use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let outcome = dispatch::run(&args, &system::RealSystem);

    // Written and flushed by hand: `process::exit` runs no destructors, and a
    // buffered stdout going into a pipe would be thrown away with them.
    let mut out = std::io::stdout();
    let _ = out.write_all(outcome.out.as_bytes());
    let _ = out.flush();
    let mut err = std::io::stderr();
    let _ = err.write_all(outcome.err.as_bytes());
    let _ = err.flush();

    std::process::exit(outcome.code);
}
