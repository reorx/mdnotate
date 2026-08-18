---
name: mdnotate-last
description: Open your own last message to the user in mdnotate, formatted as Markdown, optionally on a remote host.
allowed-tools: Bash(mdnotate:*)
disable-model-invocation: true
---

# mdnotate last

!`mdnotate last $ARGUMENTS`

mdnotate is a read-only viewer. It opens the last message you wrote in its own
window and reports nothing back here — the user reads and annotates it there,
and anything they want from you they will say themselves.

Once the command above has run, the document is open. Do not repeat the message,
do not summarise it, and do not start any follow-up work unless the user asks
for one.

If the command printed an error, say what it was in one line. Otherwise
acknowledge in one sentence and stop.
