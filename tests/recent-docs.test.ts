import { describe, expect, it } from 'vitest';
import {
  clipboardDocId,
  countChars,
  deriveClipboardTitle,
  describeClipboard,
  fileDocId,
  formatCharCount,
  formatRelativeTime,
  hashText,
  makeSnippet,
  MAX_CLIPBOARD_CHARS,
  MIN_CLIPBOARD_CHARS,
  RECENTS_LIMIT,
  upsertRecent,
} from '../src/lib/recent-docs';

/** 2026-08-11 14:30 local time — every time-dependent expectation is relative to this. */
const NOW = new Date(2026, 7, 11, 14, 30, 0).getTime();

describe('deriveClipboardTitle', () => {
  it('names the entry after its first markdown heading', () => {
    expect(deriveClipboardTitle('# Project Retro\n\nYesterday we…', NOW)).toBe('Project Retro');
  });

  it('accepts a heading at any level and ignores leading blank lines', () => {
    expect(deriveClipboardTitle('\n\n### Deep Heading\n\ntext', NOW)).toBe('Deep Heading');
  });

  it('falls back to the opening line when the content has no heading', () => {
    expect(deriveClipboardTitle('Some text copied by hand\nand a second line', NOW)).toBe('Some text copied by hand');
  });

  it('strips list and quote markers so the title reads as prose', () => {
    expect(deriveClipboardTitle('- first bullet\n- second', NOW)).toBe('first bullet');
    expect(deriveClipboardTitle('> a quoted sentence', NOW)).toBe('a quoted sentence');
    expect(deriveClipboardTitle('1. numbered item', NOW)).toBe('numbered item');
  });

  it('truncates an overlong first line', () => {
    const title = deriveClipboardTitle('x'.repeat(200), NOW);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to a timestamp when the content opens with a code fence', () => {
    expect(deriveClipboardTitle('```js\nconst a = 1\n```', NOW)).toBe('Clipboard · 08-11 14:30');
  });

  it('falls back to a timestamp for content that is only whitespace', () => {
    expect(deriveClipboardTitle('   \n\n\t', NOW)).toBe('Clipboard · 08-11 14:30');
  });

  it('falls back to a timestamp when the opening line is only markers', () => {
    expect(deriveClipboardTitle('---\n\nsomething', NOW)).toBe('Clipboard · 08-11 14:30');
  });
});

describe('makeSnippet', () => {
  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(makeSnippet('first line\n\n  second   line\t')).toBe('first line second line');
  });

  it('truncates long content with an ellipsis', () => {
    const snippet = makeSnippet('y'.repeat(300));
    expect(snippet.length).toBeLessThanOrEqual(101);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('returns an empty string for blank content', () => {
    expect(makeSnippet('   \n  ')).toBe('');
  });
});

describe('countChars', () => {
  it('counts CJK characters as one each', () => {
    expect(countChars('中文字数')).toBe(4);
  });

  it('counts an astral emoji as a single character rather than a surrogate pair', () => {
    expect(countChars('a😀b')).toBe(3);
  });

  it('counts an empty string as zero', () => {
    expect(countChars('')).toBe(0);
  });
});

describe('hashText', () => {
  it('is stable for identical content', () => {
    expect(hashText('same content')).toBe(hashText('same content'));
  });

  it('separates content that differs only in whitespace', () => {
    expect(hashText('a b')).not.toBe(hashText('a  b'));
  });

  it('separates content of the same length', () => {
    expect(hashText('abcd')).not.toBe(hashText('abce'));
  });
});

// Recent entries dedup on their id, so the id itself carries the dedup rule:
// files collapse by path, clipboard entries collapse by content.
describe('document ids', () => {
  it('identifies a file by its path', () => {
    expect(fileDocId('/tmp/a.md')).toBe(fileDocId('/tmp/a.md'));
    expect(fileDocId('/tmp/a.md')).not.toBe(fileDocId('/tmp/b.md'));
  });

  it('collapses two pastes of identical text onto one id', () => {
    expect(clipboardDocId('# Notes\nbody')).toBe(clipboardDocId('# Notes\nbody'));
  });

  it('keeps different pastes apart', () => {
    expect(clipboardDocId('one')).not.toBe(clipboardDocId('two'));
  });

  it('never confuses a file with a clipboard entry', () => {
    expect(clipboardDocId('/tmp/a.md')).not.toBe(fileDocId('/tmp/a.md'));
  });
});

describe('upsertRecent', () => {
  const entry = (id: string, openedAt: number) => ({ id, openedAt });

  it('puts a newly opened document at the front', () => {
    const list = upsertRecent([entry('a', 200), entry('b', 100)], entry('c', 300));
    expect(list.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('lifts a re-opened document back to the front instead of duplicating it', () => {
    const list = upsertRecent([entry('a', 300), entry('b', 200), entry('c', 100)], entry('c', 400));
    expect(list.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps the newer timestamp when a document is re-opened', () => {
    const list = upsertRecent([entry('a', 100)], entry('a', 500));
    expect(list).toEqual([entry('a', 500)]);
  });

  it('drops the oldest entries once the list is full', () => {
    const full = Array.from({ length: RECENTS_LIMIT }, (_, i) => entry(`id-${i}`, i + 1));
    const list = upsertRecent(full, entry('newest', 10_000));
    expect(list).toHaveLength(RECENTS_LIMIT);
    expect(list[0].id).toBe('newest');
    // `id-0` was the oldest, so it is the one that falls off.
    expect(list.some((e) => e.id === 'id-0')).toBe(false);
  });

  it('leaves the list unchanged in length when a full list re-opens an existing entry', () => {
    const full = Array.from({ length: RECENTS_LIMIT }, (_, i) => entry(`id-${i}`, i + 1));
    const list = upsertRecent(full, entry('id-0', 10_000));
    expect(list).toHaveLength(RECENTS_LIMIT);
    expect(list[0].id).toBe('id-0');
  });
});

describe('describeClipboard', () => {
  it('reports an unreadable clipboard and refuses to open', () => {
    const d = describeClipboard(null);
    expect(d.state).toBe('empty');
    expect(d.canOpen).toBe(false);
    expect(d.charCount).toBe(0);
  });

  it('treats whitespace-only clipboard content as empty', () => {
    const d = describeClipboard('  \n\t ');
    expect(d.state).toBe('empty');
    expect(d.canOpen).toBe(false);
  });

  it('reports the character count and a preview for readable content', () => {
    const text = `# Notes\n\n${'Some copied prose. '.repeat(20)}`;
    const d = describeClipboard(text);
    expect(d.state).toBe('ready');
    expect(d.canOpen).toBe(true);
    expect(d.charCount).toBe(countChars(text));
    expect(d.snippet.startsWith('# Notes Some copied prose.')).toBe(true);
    expect(d.label).toContain(String(d.charCount));
  });

  it('groups the character count for readability', () => {
    const d = describeClipboard('z'.repeat(3214));
    expect(d.label).toContain('3,214');
  });

  // A copied word, URL or line of code is not what this app is for; only a
  // paste long enough to be worth reading gets offered.
  it('refuses a paste at or below the minimum length', () => {
    const d = describeClipboard('z'.repeat(MIN_CLIPBOARD_CHARS));
    expect(d.state).toBe('too-short');
    expect(d.canOpen).toBe(false);
    expect(d.snippet).toBe('');
    expect(d.label).toMatch(/too short/i);
  });

  it('offers a paste one character over the minimum', () => {
    const d = describeClipboard('z'.repeat(MIN_CLIPBOARD_CHARS + 1));
    expect(d.state).toBe('ready');
    expect(d.canOpen).toBe(true);
  });

  it('measures the paste in characters, not code units', () => {
    // 150 astral emoji are 300 code units but only 150 characters.
    const d = describeClipboard('😀'.repeat(150));
    expect(d.charCount).toBe(150);
    expect(d.state).toBe('too-short');
  });

  it('refuses content beyond the size limit', () => {
    const d = describeClipboard('z'.repeat(MAX_CLIPBOARD_CHARS + 1));
    expect(d.state).toBe('too-large');
    expect(d.canOpen).toBe(false);
    expect(d.label).toMatch(/too large/i);
  });
});

describe('formatCharCount', () => {
  it('groups thousands independently of the host locale', () => {
    expect(formatCharCount(3214)).toBe('3,214');
    expect(formatCharCount(999)).toBe('999');
    expect(formatCharCount(1234567)).toBe('1,234,567');
  });
});

describe('formatRelativeTime', () => {
  it('describes the last minute as just now', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('just now');
  });

  it('counts minutes within the hour', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5m ago');
  });

  it('counts hours within the day', () => {
    expect(formatRelativeTime(NOW - 3 * 3600_000, NOW)).toBe('3h ago');
  });

  it('counts days within the week', () => {
    expect(formatRelativeTime(NOW - 3 * 86400_000, NOW)).toBe('3d ago');
  });

  it('switches to a calendar date beyond a week', () => {
    expect(formatRelativeTime(new Date(2026, 6, 2, 9, 0, 0).getTime(), NOW)).toBe('07-02');
  });

  it('includes the year for dates outside the current year', () => {
    expect(formatRelativeTime(new Date(2025, 10, 20, 9, 0, 0).getTime(), NOW)).toBe('2025-11-20');
  });
});
