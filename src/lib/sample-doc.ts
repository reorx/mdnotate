/** Sample document shown when running in a plain browser (dev only). */
export const SAMPLE_DOC_PATH = '/tmp/sample-document.md';

export const SAMPLE_DOC = `# Sample Document

This is a sample document shown because the app is running in a plain browser
without the Tauri backend. Select any text to highlight or comment on it.

## Getting Started

mdnotate is a reader for local Markdown files. Set it as the default app for
\`.md\` files and double-click any of them in Finder.

### Highlighting

Select a passage of text with the mouse. A small popup appears with two
actions: **Highlight** keeps a plain highlight, **Comment** attaches a note.

### Exporting

Click "Export Annotation" in the toolbar to see all highlights as Markdown
blockquotes, each followed by its comment. Copy the result anywhere.

## Reading Comfort

The typography is deliberately dense: small margins, tight line-height, and a
narrow measure keep the signal-to-noise ratio high.

- Lists are compact
- Nested items stay close
  - Like this one
- Links look like [this](https://example.com)

## Code

\`\`\`python
def annotate(text: str) -> str:
    return f"> {text}"
\`\`\`

## Tables

| Feature | Status |
| ------- | ------ |
| Reading | Done   |
| Annotations | Done |

## Closing Words

Scroll around to watch the table of contents track the current heading.
`;
