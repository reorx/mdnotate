// Two things a note-taker writes that remark-math does not read the way they
// meant it, rewritten *for rendering only* — like `box-table`, the document in
// the store stays byte-for-byte the source, so source view, stats and the
// content hash never see this transform.
//
// 1. `\(…\)` and `\[…\]`. CommonMark eats the backslash as an escape before any
//    plugin is given a chance, so `\(a+b\)` reaches the renderer as `(a+b)`.
//    No remark plugin can fix that; it has to happen to the source.
// 2. `$$x$$` written on one line. remark-math's flow construct wants the fence
//    on a line of its own, so a one-liner falls through to *inline* math —
//    while LaTeX, Pandoc and MathJax all read it as display, and KaTeX refuses
//    `\begin{align}` outside display mode. So the one-liner is spread onto
//    three lines, but only when the line holds nothing else: `$$a$$` in the
//    middle of a sentence really is inline, and moving it would break the
//    sentence in half.
//
// Both rewrites keep out of code. A fenced block is copied through untouched
// and also acts as a hard barrier — no inline code span and no `\[…\]` pair may
// reach across one.

/** The run of identical characters starting at `i`. */
function runLength(text: string, i: number, ch: string): number {
  let n = 0;
  while (text[i + n] === ch) n++;
  return n;
}

/** The next backtick run of exactly `len`, which is what closes a code span. */
function findBacktickRun(text: string, from: number, len: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] !== '`') continue;
    const run = runLength(text, i, '`');
    if (run === len) return i;
    i += run - 1;
  }
  return -1;
}

type Delimiter = { at: number; kind: '(' | ')' | '[' | ']' };

/**
 * The LaTeX math delimiters in a stretch of prose, skipping code spans.
 *
 * Backslash escapes are consumed in pairs, which is what keeps `\\(` — a
 * literal backslash, as a matrix row separator leaves, followed by a bracket —
 * from being read as an opening delimiter.
 */
function scanDelimiters(text: string): Delimiter[] {
  const found: Delimiter[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '`') {
      const run = runLength(text, i, '`');
      const close = findBacktickRun(text, i + run, run);
      // An unclosed run is not a code span at all — it is a literal backtick.
      i = close === -1 ? i + run : close + run;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === '(' || next === ')' || next === '[' || next === ']') found.push({ at: i, kind: next });
      i += 2;
      continue;
    }
    i += 1;
  }
  return found;
}

/** `\(…\)` → `$…$`, `\[…\]` → `$$…$$`, for one fence-free stretch of source. */
function rewriteDelimiters(text: string): string {
  if (!text.includes('\\(') && !text.includes('\\[')) return text;

  const edits: { at: number; text: string }[] = [];
  const pair = (open: number, close: number, dollars: string) => {
    // An empty formula is a pair of brackets someone wrote about brackets.
    if (text.slice(open + 2, close).trim() === '') return;
    edits.push({ at: open, text: dollars }, { at: close, text: dollars });
  };

  let inline = -1;
  let display = -1;
  for (const { at, kind } of scanDelimiters(text)) {
    if (kind === '(') inline = at;
    else if (kind === '[') display = at;
    else if (kind === ')' && inline >= 0) {
      pair(inline, at, '$');
      inline = -1;
    } else if (kind === ']' && display >= 0) {
      pair(display, at, '$$');
      display = -1;
    }
  }
  if (edits.length === 0) return text;

  edits.sort((a, b) => a.at - b.at);
  let out = '';
  let read = 0;
  for (const edit of edits) {
    out += text.slice(read, edit.at) + edit.text;
    read = edit.at + 2; // the two characters of `\(`, `\)`, `\[` or `\]`
  }
  return out + text.slice(read);
}

/**
 * A line that is nothing but one `$$…$$`, spread onto its own fence. The
 * leading indent and quote markers are repeated on all three lines, or a
 * formula inside a list item or a blockquote would fall out of it.
 */
function spreadDisplayLine(line: string): string[] | null {
  const match = line.match(/^([ \t>]*)(\$\$.*\$\$)[ \t]*$/);
  if (!match) return null;
  const [, prefix, body] = match;
  const inner = body.slice(2, -2);
  // `$$a$$ and $$b$$` is two inline formulas in a sentence, not one display.
  if (inner.trim() === '' || inner.includes('$$')) return null;
  return [`${prefix}$$`, `${prefix}${inner}`, `${prefix}$$`];
}

function rewriteSegment(segment: string): string {
  return rewriteDelimiters(segment)
    .split('\n')
    .flatMap((line) => spreadDisplayLine(line) ?? [line])
    .join('\n');
}

export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes('\\(') && !markdown.includes('\\[') && !markdown.includes('$$')) return markdown;

  const lines = markdown.split('\n');
  const out: string[] = [];
  let pending: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (pending.length === 0) return;
    out.push(...rewriteSegment(pending.join('\n')).split('\n'));
    pending = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (fence) {
      out.push(line);
      if (trimmed.startsWith(fence) && new Set(trimmed).size === 1) fence = null;
      continue;
    }
    const opensFence = trimmed.match(/^(`{3,}|~{3,})/);
    if (opensFence) {
      flush();
      fence = opensFence[1];
      out.push(line);
      continue;
    }
    pending.push(line);
  }
  flush();
  return out.join('\n');
}
