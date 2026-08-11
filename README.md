# mdnotate

**Markdown Annotate** — a Tauri desktop app for reading local Markdown files and annotating them with highlights and comments.

Register it as the default opener for `.md` / `.markdown` files, read in a dense, reader-friendly layout, select text to highlight or comment, then export all annotations as Markdown blockquotes (each followed by its comment) and copy them anywhere.

## Features

- **Default Markdown opener**: file associations for `md` / `markdown` (Finder double-click, `open -a mdnotate file.md`, drag-and-drop, CLI argument; single-instance). The start screen shows whether mdnotate currently holds the association and offers a one-click **Set as Default** (macOS asks you to confirm)
- **Open Clipboard**: read whatever you just copied without saving it to a file first. The home screen shows how much text is on the clipboard and how it starts; the entry is named after its first heading (or its opening line, or the time you opened it)
- **Recent**: files and clipboard entries in one list, newest first, stored in SQLite. Files are re-read from disk, clipboard text is kept in the database so it stays re-openable. Capped at 50, deduplicated (files by path, clipboard by content), removable one by one or all at once
- **Reading-first typography**: dense layout, high signal-to-noise, no editing
- **TOC sidebar**: heading tree, click to jump, scroll-spy highlights the current heading
- **Annotations**: select text → Highlight or Comment (powered by `@recogito/text-annotator`, in-memory per session)
- **Export Annotation**: renders annotations through a configurable template into a copyable text box
- **Settings**: customize the export template with `{{filePath}}` and `{{annotations}}` placeholders (persisted via tauri-plugin-store)

Default template:

```
# {{filePath}}

{{annotations}}
```

## Development

Prereqs: Rust, Node 24 (managed by mise), pnpm.

```bash
pnpm install
pnpm tauri dev     # run the app
pnpm test          # vitest unit tests (annotations / template / toc)
pnpm tauri build   # release bundle (.app + .dmg)
```

Opening `pnpm dev` in a plain browser loads a built-in sample document (no Tauri backend) — handy for UI work.

## Structure

- `src/lib/` — pure logic (annotation list ops + markdown serialization, export template, TOC slugs, clipboard-entry naming and previews), the recents database, `open-doc.ts` (the single entry point every document open funnels through) and the `use-text-annotator` hook
- `src/components/` — Home (open file / open clipboard / recent), Reader (markdown + TOC + annotator), AnnotationPopup, ExportView, SettingsView
- `src-tauri/` — file-open routing (macOS `RunEvent::Opened`, argv, single-instance, drag-drop → one pending-open queue), `read_markdown_file` command, the `recent_docs` SQLite migration, `default_app.rs` (LaunchServices FFI), `Info.plist` document types
- `tests/` — vitest behavior tests for the pure logic
