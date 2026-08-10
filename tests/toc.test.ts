import { describe, expect, it } from 'vitest';
import { buildToc, slugify } from '../src/lib/toc';

describe('slugify', () => {
  it('lowercases and replaces spaces with dashes', () => {
    expect(slugify('Getting Started')).toBe('getting-started');
  });

  it('strips punctuation but keeps unicode word characters (e.g. Chinese)', () => {
    expect(slugify('安装与配置!')).toBe('安装与配置');
    expect(slugify("What's New?")).toBe('whats-new');
  });

  it('falls back to "section" for headings with no sluggable characters', () => {
    expect(slugify('!!!')).toBe('section');
  });
});

describe('buildToc', () => {
  it('assigns unique ids, deduplicating repeated heading texts with numeric suffixes', () => {
    const toc = buildToc([
      { level: 2, text: 'Usage' },
      { level: 2, text: 'Usage' },
      { level: 2, text: 'Usage' },
    ]);
    expect(toc.map((t) => t.id)).toEqual(['usage', 'usage-1', 'usage-2']);
  });

  it('preserves document order and heading levels', () => {
    const toc = buildToc([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Section' },
      { level: 3, text: 'Detail' },
    ]);
    expect(toc.map((t) => [t.level, t.text])).toEqual([
      [1, 'Title'],
      [2, 'Section'],
      [3, 'Detail'],
    ]);
  });

  it('returns an empty list for a document without headings', () => {
    expect(buildToc([])).toEqual([]);
  });
});
