# Agent skills

Two slash commands for Claude Code, so that a document can be put in front of
someone without leaving the conversation:

- `/mdnotate <file ...> [-h <host>]` — open files in mdnotate
- `/mdnotate-last [-h <host>]` — open the last thing Claude said, as Markdown

Both are thin wrappers around the `mdnotate` command, which has to be installed
first: open mdnotate, and use the **Command Line** card on the home screen.

Claude Code only looks for skills in `~/.claude/skills` and `.claude/skills`, so
these need linking there once:

```sh
ln -s "$PWD/skills/mdnotate" "$PWD/skills/mdnotate-last" ~/.claude/skills/
```

Linked rather than copied, so that a `git pull` updates them.

## Why they say so little

mdnotate is read-only and opens its own window. Nothing comes back to the
conversation, so unlike an annotation tool there is no verdict to branch on —
the whole of each skill is "run this, then stop". The instruction not to start
follow-up work is the only part that earns its place: without it, an assistant
that has just handed over a document tends to begin acting on it.
