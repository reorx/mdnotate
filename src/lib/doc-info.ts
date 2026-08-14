/**
 * What the title bar can say about the document it names: where it came from,
 * how big it is, when it was last written.
 *
 * Size is measured off the text rather than asked of the filesystem. The
 * content arrived as a UTF-8 string and UTF-8 is what the file holds, so
 * encoding it back gives the byte count on disk — and the same one line of
 * arithmetic then works for a document read over ssh or pasted from the
 * clipboard, neither of which has a file to stat.
 *
 * The modification time is the one thing that cannot be derived, so it travels
 * with the document from `read_local_file`. Remote and clipboard documents have
 * none, and a row with nothing in it is left out rather than filled with a dash.
 */

import { countChars, formatCharCount, type DocKind, type OpenDoc } from './recent-docs';

export interface DocInfoField {
  label: string;
  value: string;
}

export interface DocInfo {
  /** What kind of address `source` is, since the three kinds are not alike. */
  sourceLabel: string;
  /** The line worth copying: a path, a `host:path`, or the name a paste was given. */
  source: string;
  fields: DocInfoField[];
}

const SOURCE_LABELS: Record<DocKind, string> = {
  file: 'Path',
  ssh: 'Remote path',
  clipboard: 'Clipboard',
};

const UNITS = ['B', 'KB', 'MB', 'GB'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** How many bytes this text occupies as UTF-8 — which is how it sits on disk. */
export function contentBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * A size to read at a glance. Bytes come out whole; anything scaled gets one
 * decimal, minus a trailing `.0` that only adds width. Past the last unit it
 * keeps counting in that unit rather than naming one nobody has a feel for.
 */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  return `${shown} ${UNITS[unit]}`;
}

/** Written out by hand, in the local zone, so the host locale cannot reorder it. */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Everything the info popover shows, ready to render. */
export function docInfo(doc: OpenDoc): DocInfo {
  const fields: DocInfoField[] = [{ label: 'Size', value: formatBytes(contentBytes(doc.content)) }];
  if (doc.modifiedAt !== undefined) {
    fields.push({ label: 'Modified', value: formatTimestamp(doc.modifiedAt) });
  }
  fields.push({ label: 'Characters', value: formatCharCount(countChars(doc.content)) });
  return { sourceLabel: SOURCE_LABELS[doc.kind], source: doc.source, fields };
}
