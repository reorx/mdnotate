---
name: mdnotate
description: Open one or more Markdown or text files in mdnotate, the local read-only viewer, optionally sending them to a remote host first.
allowed-tools: Bash(mdnotate:*)
disable-model-invocation: true
---

# mdnotate

!`mdnotate $ARGUMENTS`

mdnotate is a read-only viewer. It opens its own window and reports nothing
back here. Once the command above has run, the document is open — do not wait
for a reply, and do not start any follow-up work unless the user asks for one.

If the command printed an error, say what it was in one line. Otherwise
acknowledge in one sentence and stop.
