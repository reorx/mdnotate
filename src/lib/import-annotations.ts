import type { Annotation } from './annotations';
import type { OpenDoc } from './recent-docs';

/**
 * Reverse only the default text export, never Markdown syntax. Its quotes are
 * already rendered text: interpreting emphasis or trimming spaces corrupts the
 * very string used for exact anchoring. The path heading is informational.
 *
 * The format has no escaping for entry delimiters. A blank line followed by
 * `> ` is necessarily treated as a new entry; a quote line inside a comment
 * without that separator is a recognizable ambiguity and is rejected. The UI
 * explains the remaining lossiness and shows every inferred boundary.
 */
export type ImportStatus = 'ready' | 'duplicate' | 'missing' | 'ambiguous' | 'format-error';
export interface ImportRow {
  number: number;
  quote: string;
  comment: string | null;
  status: ImportStatus;
  start?: number;
  end?: number;
}
export interface AnnotationImportPreview {
  /** Identity also invalidates reopening the same document with the same hash. */
  doc: OpenDoc;
  input: string;
  text: string;
  rows: ImportRow[];
}

function parseEntries(input: string): ImportRow[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.startsWith('# ')) lines.shift();
  const entries: string[][] = [];
  let entry: string[] = [];
  for (const line of lines) {
    // A blank separator followed by a quote begins a new exported entry.
    if (line.startsWith('>') && entry.at(-1) === '') {
      while (entry.at(-1) === '') entry.pop();
      if (entry.length) entries.push(entry);
      entry = [];
    }
    if (entry.length || line !== '') entry.push(line);
  }
  while (entry.at(-1) === '') entry.pop();
  if (entry.length) entries.push(entry);
  if (!entries.length) return [{ number: 1, quote: '', comment: null, status: 'format-error' }];
  return entries.map((lines, index) => {
    let endQuote = 0;
    while (lines[endQuote]?.startsWith('> ')) endQuote++;
    const quote = lines
      .slice(0, endQuote)
      .map((line) => line.slice(2))
      .join('\n');
    const commentLines = lines.slice(endQuote);
    const invalid = !quote || !endQuote || commentLines.some((line) => line.startsWith('>'));
    return {
      number: index + 1,
      quote: endQuote ? quote : lines.join('\n'),
      comment: commentLines.length ? commentLines.join('\n') : null,
      status: invalid ? 'format-error' : 'ready',
    };
  });
}

function sameEntry(a: Pick<ImportRow, 'quote' | 'comment' | 'start' | 'end'>, b: ImportRow): boolean {
  return a.start === b.start && a.end === b.end && a.quote === b.quote && a.comment === b.comment;
}

/** Exact UTF-16 offsets over collectAnnotatableText, including overlapping hits. */
export function previewAnnotationImport(input: string, text: string, existing: Annotation[]): ImportRow[] {
  const rows = parseEntries(input);
  const accepted: ImportRow[] = [];
  for (const row of rows) {
    if (row.status === 'format-error') continue;
    const start = text.indexOf(row.quote);
    if (start < 0) row.status = 'missing';
    else if (text.indexOf(row.quote, start + 1) >= 0) row.status = 'ambiguous';
    else {
      row.start = start;
      row.end = start + row.quote.length;
      if (existing.some((a) => sameEntry(a, row)) || accepted.some((a) => sameEntry(a, row))) row.status = 'duplicate';
      else accepted.push(row);
    }
  }
  return rows;
}

export function prepareAnnotationImport(
  doc: OpenDoc,
  input: string,
  text: string,
  existing: Annotation[],
): AnnotationImportPreview {
  return { doc, input, text, rows: previewAnnotationImport(input, text, existing) };
}

/** Shared by the panel and the submission gate; do not anchor into source text. */
export function importUnavailableReason({
  editing,
  sourceView,
  annotationsHash,
  contentHash,
}: {
  editing: boolean;
  sourceView: boolean;
  annotationsHash: string | null;
  contentHash: string | null;
}): string | null {
  if (editing) return 'Switch to View to import annotations';
  if (sourceView) return 'Switch to rendered view to import annotations';
  if (annotationsHash !== contentHash) return 'Wait for annotations to finish relocating';
  return null;
}
