import { describe, expect, it } from 'vitest';
import { contentBytes, docInfo, formatBytes, formatTimestamp } from '../src/lib/doc-info';
import type { OpenDoc } from '../src/lib/recent-docs';

/** 2026-08-11 14:30:05 local time. */
const MODIFIED = new Date(2026, 7, 11, 14, 30, 5).getTime();

function makeDoc(patch: Partial<OpenDoc> = {}): OpenDoc {
  return {
    id: 'file:/Users/me/notes/plan.md',
    kind: 'file',
    title: 'plan.md',
    source: '/Users/me/notes/plan.md',
    content: 'hello',
    format: 'markdown',
    contentHash: 'abc',
    ...patch,
  };
}

describe('contentBytes', () => {
  it('counts one byte per ASCII character', () => {
    expect(contentBytes('hello')).toBe(5);
  });

  it('counts what UTF-8 actually costs, not what the string length says', () => {
    // The size is meant to match the file on disk, and disk holds UTF-8.
    expect(contentBytes('中文')).toBe(6);
    expect(contentBytes('é')).toBe(2);
    expect(contentBytes('😀')).toBe(4);
  });

  it('is zero for an empty document', () => {
    expect(contentBytes('')).toBe(0);
  });
});

describe('formatBytes', () => {
  it('shows small files as whole bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('switches unit at each multiple of 1024', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('keeps one decimal for a scaled size', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12_600)).toBe('12.3 KB');
  });

  it('drops a decimal that says nothing', () => {
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('stays in the largest unit it knows rather than inventing one', () => {
    expect(formatBytes(5 * 1024 ** 4)).toBe('5120 GB');
  });
});

describe('formatTimestamp', () => {
  it('writes the date and time zero-padded, largest unit first', () => {
    expect(formatTimestamp(MODIFIED)).toBe('2026-08-11 14:30');
  });

  it('pads single-digit months, days, hours and minutes', () => {
    expect(formatTimestamp(new Date(2026, 0, 2, 3, 4, 0).getTime())).toBe('2026-01-02 03:04');
  });
});

describe('docInfo', () => {
  it('describes a local file by its path, its size and when it was last written', () => {
    const info = docInfo(makeDoc({ content: 'x'.repeat(2048), modifiedAt: MODIFIED }));
    expect(info.sourceLabel).toBe('Path');
    expect(info.source).toBe('/Users/me/notes/plan.md');
    expect(info.fields).toEqual([
      { label: 'Size', value: '2 KB' },
      { label: 'Modified', value: '2026-08-11 14:30' },
      { label: 'Characters', value: '2,048' },
    ]);
  });

  it('leaves out the modified row when nothing recorded one', () => {
    const info = docInfo(makeDoc());
    expect(info.fields.map((f) => f.label)).toEqual(['Size', 'Characters']);
  });

  it('names a remote document by host and path, with no modified row', () => {
    const info = docInfo(
      makeDoc({
        id: 'ssh:box:notes/plan.md',
        kind: 'ssh',
        source: 'box:notes/plan.md',
      }),
    );
    expect(info.sourceLabel).toBe('Remote path');
    expect(info.source).toBe('box:notes/plan.md');
    expect(info.fields.map((f) => f.label)).toEqual(['Size', 'Characters']);
  });

  it('names a clipboard document by the title it was given', () => {
    const info = docInfo(
      makeDoc({
        id: 'clip:deadbeef',
        kind: 'clipboard',
        title: 'Project Retro',
        source: 'Project Retro',
      }),
    );
    expect(info.sourceLabel).toBe('Clipboard');
    expect(info.source).toBe('Project Retro');
  });

  it('groups the character count so a long document stays readable', () => {
    const info = docInfo(makeDoc({ content: 'a'.repeat(12_345) }));
    expect(info.fields.find((f) => f.label === 'Characters')?.value).toBe('12,345');
  });

  it('counts characters the way the rest of the app does — by code point', () => {
    const info = docInfo(makeDoc({ content: '😀😀' }));
    expect(info.fields.find((f) => f.label === 'Characters')?.value).toBe('2');
    expect(info.fields.find((f) => f.label === 'Size')?.value).toBe('8 B');
  });
});
