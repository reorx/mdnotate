/**
 * The recent-documents model and every pure rule around it: how a clipboard
 * paste gets a name, how it is previewed, and how entries are identified.
 *
 * Identity carries the dedup rule — files collapse by path, clipboard entries
 * collapse by content — so the storage layer only ever upserts on `id`.
 */

export type DocKind = 'file' | 'clipboard';

/** A document currently open in the reader. */
export interface OpenDoc {
  /** Also the annotator's document key and the recents primary key. */
  id: string;
  kind: DocKind;
  /** Shown in the title bar. */
  title: string;
  /** What `{{filePath}}` renders to: the full path for files, the title for clipboard entries. */
  source: string;
  content: string;
}

/** A row of the recents list. The clipboard body is fetched separately, on open. */
export interface RecentDoc {
  id: string;
  kind: DocKind;
  title: string;
  source: string;
  snippet: string;
  charCount: number;
  openedAt: number;
}

/** Pastes beyond this are refused rather than stored — a paste that large is not something to read. */
export const MAX_CLIPBOARD_CHARS = 2_000_000;

/**
 * A paste has to be longer than this to be offered. A copied word, URL or line
 * of code is not a document, and lighting up the card for one is just noise.
 */
export const MIN_CLIPBOARD_CHARS = 200;

/** How many entries the recents list keeps before the oldest fall off. */
export const RECENTS_LIMIT = 50;

const TITLE_MAX = 60;
const SNIPPET_MAX = 100;

const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const CODE_FENCE = /^\s{0,3}(?:```|~~~)/;
const LEADING_MARKER = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)/;
const HAS_WORD = /[\p{L}\p{N}]/u;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Slice without ever splitting a surrogate pair in half. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** Count code points, so CJK and emoji each read as one character. */
export function countChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) i++;
    count++;
  }
  return count;
}

/** FNV-1a, widened with the length. Only used to collapse identical pastes. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + text.length.toString(36);
}

export function fileDocId(path: string): string {
  return `file:${path}`;
}

export function clipboardDocId(text: string): string {
  return `clip:${hashText(text)}`;
}

/** One-line preview: whitespace collapsed, truncated. */
export function makeSnippet(text: string, max = SNIPPET_MAX): string {
  // Collapsing the whole of a multi-megabyte paste would be wasted work.
  return truncate(
    text
      .slice(0, max * 4)
      .replace(/\s+/g, ' ')
      .trim(),
    max,
  );
}

/**
 * Name a clipboard entry after what it says: its first heading, else its
 * opening line. Content that opens with a code fence or has no prose in its
 * first line gets a timestamp instead — a fence marker is not a title.
 */
export function deriveClipboardTitle(text: string, now: number): string {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (CODE_FENCE.test(line)) break;
    const heading = line.match(HEADING);
    const candidate = (heading ? heading[1].replace(/\s+#+\s*$/, '') : line.replace(LEADING_MARKER, '')).trim();
    if (HAS_WORD.test(candidate)) return truncate(candidate, TITLE_MAX);
    break;
  }
  const d = new Date(now);
  return `Clipboard · ${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Group thousands without depending on the host locale. */
export function formatCharCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export type ClipboardState = 'empty' | 'too-short' | 'ready' | 'too-large';

export interface ClipboardPreview {
  state: ClipboardState;
  charCount: number;
  snippet: string;
  label: string;
  canOpen: boolean;
}

/** What the "Open Clipboard" card should say about the current clipboard text. */
export function describeClipboard(text: string | null): ClipboardPreview {
  if (!text || !text.trim()) {
    return { state: 'empty', charCount: 0, snippet: '', label: 'Clipboard is empty', canOpen: false };
  }
  const charCount = countChars(text);
  if (charCount <= MIN_CLIPBOARD_CHARS) {
    return {
      state: 'too-short',
      charCount,
      snippet: '',
      label: `Clipboard content is too short (${formatCharCount(charCount)} characters)`,
      canOpen: false,
    };
  }
  if (charCount > MAX_CLIPBOARD_CHARS) {
    return {
      state: 'too-large',
      charCount,
      snippet: '',
      label: `Clipboard content is too large (${formatCharCount(charCount)} characters)`,
      canOpen: false,
    };
  }
  return {
    state: 'ready',
    charCount,
    snippet: makeSnippet(text),
    label: `${formatCharCount(charCount)} characters`,
    canOpen: true,
  };
}

/**
 * Apply an open to a recents list: the entry replaces any earlier one carrying
 * the same id, the list stays newest-first, and it never grows past the cap.
 *
 * This is the same rule the SQL upsert-and-prune in `recents-db.ts` enforces —
 * kept here so it can be stated once, in prose, and tested.
 */
export function upsertRecent<T extends { id: string; openedAt: number }>(
  entries: T[],
  entry: T,
  limit = RECENTS_LIMIT,
): T[] {
  const rest = entries.filter((e) => e.id !== entry.id);
  return [entry, ...rest].sort((a, b) => b.openedAt - a.openedAt).slice(0, limit);
}

/** Relative for the last week, calendar date beyond it. */
export function formatRelativeTime(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}d ago`;
  const d = new Date(ts);
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}-${md}`;
}
