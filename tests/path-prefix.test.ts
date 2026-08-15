import { describe, expect, it } from 'vitest';
import { joinPrefixSuffix, matchPrefixes, upsertPrefix, PREFIXES_LIMIT } from '../src/lib/path-prefix';

describe('joinPrefixSuffix', () => {
  it('puts a separator between the two halves', () => {
    expect(joinPrefixSuffix('~/Sync/notes', '2026-08-15.md')).toBe('~/Sync/notes/2026-08-15.md');
  });

  it('leaves a prefix that already ends in a slash alone', () => {
    expect(joinPrefixSuffix('~/Sync/notes/', '2026-08-15.md')).toBe('~/Sync/notes/2026-08-15.md');
  });

  it('never produces a doubled slash', () => {
    expect(joinPrefixSuffix('~/Sync/notes/', '/2026-08-15.md')).toBe('~/Sync/notes/2026-08-15.md');
  });

  // A suffix asking for the root is asking for the root.
  it('keeps a rooted suffix rooted', () => {
    expect(joinPrefixSuffix('/', '/etc/hosts.md')).toBe('/etc/hosts.md');
  });

  /*
   * The one place the separator must not go. `host:path` is relative to the
   * remote home, `host:/path` is the remote root — so a slash inserted after
   * the colon opens a different file, silently.
   */
  it('does not separate a remote host from a home-relative path', () => {
    expect(joinPrefixSuffix('maiev.ts:', 'Sync/a.md')).toBe('maiev.ts:Sync/a.md');
  });

  it('leaves a rooted remote path rooted', () => {
    expect(joinPrefixSuffix('maiev.ts:', '/srv/a.md')).toBe('maiev.ts:/srv/a.md');
  });

  it('separates the segments of a remote path like any other', () => {
    expect(joinPrefixSuffix('maiev.ts:Sync', 'a.md')).toBe('maiev.ts:Sync/a.md');
  });

  it('gives a bare ~ its slash back', () => {
    expect(joinPrefixSuffix('~', 'notes/a.md')).toBe('~/notes/a.md');
  });

  it('is the suffix alone when there is no prefix', () => {
    expect(joinPrefixSuffix('', '/tmp/a.md')).toBe('/tmp/a.md');
    expect(joinPrefixSuffix('   ', '/tmp/a.md')).toBe('/tmp/a.md');
  });

  it('is the prefix alone when there is no suffix', () => {
    expect(joinPrefixSuffix('/tmp/a.md', '')).toBe('/tmp/a.md');
    expect(joinPrefixSuffix('/tmp/a.md', '   ')).toBe('/tmp/a.md');
  });

  it('is empty when both halves are', () => {
    expect(joinPrefixSuffix('', '')).toBe('');
  });

  // Each half arrives in the same dialects the whole-path box accepts.
  it('undresses each half before joining', () => {
    expect(joinPrefixSuffix('"~/My Notes"', '2026-08-15.md')).toBe('~/My Notes/2026-08-15.md');
    expect(joinPrefixSuffix('~/My\\ Notes', 'a\\ b.md')).toBe('~/My Notes/a b.md');
  });

  // Nothing here splits on whitespace: a space is an ordinary character in a
  // path, and only the ends are trimmed.
  it('keeps spaces inside either half', () => {
    expect(joinPrefixSuffix(' ~/My Notes ', ' a b.md ')).toBe('~/My Notes/a b.md');
  });

  // Prefixes are made to end in a separator; suffixes never are.
  it('does not mind a prefix that is only a separator', () => {
    expect(joinPrefixSuffix('/', 'tmp/a.md')).toBe('/tmp/a.md');
  });
});

describe('matchPrefixes', () => {
  const PREFIXES = ['~/Sync/notes/', '~/Code/mdnotate/notes/', 'maiev.ts:Sync/logs/', '/Users/reorx/Desktop/'];

  it('offers the most recent ones when nothing has been typed', () => {
    expect(matchPrefixes(PREFIXES, '')).toEqual(PREFIXES);
    expect(matchPrefixes(PREFIXES, '   ')).toEqual(PREFIXES);
  });

  it('matches anywhere in the prefix, not just at its start', () => {
    expect(matchPrefixes(PREFIXES, 'notes')).toEqual(['~/Sync/notes/', '~/Code/mdnotate/notes/']);
  });

  it('ignores case', () => {
    expect(matchPrefixes(PREFIXES, 'DESKTOP')).toEqual(['/Users/reorx/Desktop/']);
  });

  // Typing the beginning of a prefix is the strongest thing the input says.
  it('puts the ones that start with what was typed first', () => {
    expect(matchPrefixes(['~/Sync/notes/', 'notes.ts:work/', '~/Code/notes/'], 'notes')).toEqual([
      'notes.ts:work/',
      '~/Sync/notes/',
      '~/Code/notes/',
    ]);
  });

  it('keeps the stored order within each group', () => {
    expect(matchPrefixes(['~/b/notes/', '~/a/notes/'], 'notes')).toEqual(['~/b/notes/', '~/a/notes/']);
  });

  it('answers with nothing when nothing matches', () => {
    expect(matchPrefixes(PREFIXES, 'zzz')).toEqual([]);
  });

  it('offers no more than it is asked for', () => {
    expect(matchPrefixes(PREFIXES, '', 2)).toEqual(['~/Sync/notes/', '~/Code/mdnotate/notes/']);
    expect(matchPrefixes(PREFIXES, 'notes', 1)).toEqual(['~/Sync/notes/']);
  });

  // The box holds a path being typed, not a search query, so it arrives in the
  // same dialects — but only the ends are trimmed, as everywhere else.
  it('ignores whitespace around what was typed', () => {
    expect(matchPrefixes(PREFIXES, '  notes  ')).toEqual(['~/Sync/notes/', '~/Code/mdnotate/notes/']);
  });
});

describe('upsertPrefix', () => {
  it('puts a new prefix at the front', () => {
    expect(upsertPrefix(['~/a/'], '~/b/')).toEqual(['~/b/', '~/a/']);
  });

  // Using one again is what makes it recent, not what makes it a second entry.
  it('lifts a prefix already there back to the front', () => {
    expect(upsertPrefix(['~/a/', '~/b/', '~/c/'], '~/c/')).toEqual(['~/c/', '~/a/', '~/b/']);
  });

  it('drops the least recently used one past the limit', () => {
    const full = Array.from({ length: PREFIXES_LIMIT }, (_, i) => `~/${i}/`);
    const next = upsertPrefix(full, '~/new/');
    expect(next).toHaveLength(PREFIXES_LIMIT);
    expect(next[0]).toBe('~/new/');
    expect(next).not.toContain(`~/${PREFIXES_LIMIT - 1}/`);
  });
});
