import { describe, expect, it } from 'vitest';
import {
  buildSearchIndex,
  findMatches,
  foldCase,
  matchLabel,
  normalizeQuery,
  stepMatch,
  type TextSegment,
} from '../src/lib/search';

const seg = (text: string, blockStart = false): TextSegment => ({ text, blockStart });

/** The text the offsets are measured against: the segments, concatenated. */
const raw = (segments: TextSegment[]) => segments.map((s) => s.text).join('');

/** What a match actually covers in the original document. */
const sliced = (segments: TextSegment[], query: string) =>
  findMatches(buildSearchIndex(segments), query).map((m) => raw(segments).slice(m.start, m.end));

describe('buildSearchIndex', () => {
  it('folds every run of whitespace down to a single space', () => {
    expect(buildSearchIndex([seg('the   quick\n\tbrown')]).text).toBe('the quick brown');
  });

  it('drops the whitespace at either end of the document', () => {
    expect(buildSearchIndex([seg('\n  hello  \n')]).text).toBe('hello');
  });

  it('writes a newline where one block ends and the next begins', () => {
    expect(buildSearchIndex([seg('foo'), seg('bar', true)]).text).toBe('foo\nbar');
  });

  it('does not open the document with a block boundary', () => {
    expect(buildSearchIndex([seg('foo', true)]).text).toBe('foo');
  });

  it('writes one newline however many empty blocks are stacked up', () => {
    expect(buildSearchIndex([seg('foo'), seg('', true), seg('', true), seg('bar', true)]).text).toBe('foo\nbar');
  });

  it('lets the boundary swallow the whitespace on either side of it', () => {
    expect(buildSearchIndex([seg('foo  '), seg('  bar', true)]).text).toBe('foo\nbar');
  });

  it('keeps inline segments of the same block in one run of text', () => {
    // <p>the <em>quick</em> fox</p> — three text nodes, no boundary between them
    expect(buildSearchIndex([seg('the '), seg('quick'), seg(' fox')]).text).toBe('the quick fox');
  });

  it('maps every normalized character back to the span it stands for', () => {
    const index = buildSearchIndex([seg('a  b')]);
    expect(index.text).toBe('a b');
    expect(index.starts).toEqual([0, 1, 3]);
    // the folded space stands for both raw spaces
    expect(index.ends).toEqual([1, 3, 4]);
  });

  it('case-folds into a string of exactly the same length', () => {
    const index = buildSearchIndex([seg('Hello Wörld İstanbul')]);
    expect(index.lower.length).toBe(index.text.length);
    expect(index.lower).toContain('hello wörld');
  });
});

describe('foldCase', () => {
  it('lowercases the ordinary cases', () => {
    expect(foldCase('MiXeD')).toBe('mixed');
  });

  it('leaves a character alone when lowercasing it would change its length', () => {
    // 'İ'.toLowerCase() is two code units; taking it would shift every offset
    // after it and highlight the wrong words.
    expect(foldCase('İ')).toBe('İ');
    expect(foldCase('aİb').length).toBe(3);
  });
});

describe('normalizeQuery', () => {
  it('folds whitespace the same way the document does', () => {
    expect(normalizeQuery('quick   brown')).toBe('quick brown');
    expect(normalizeQuery('quick\nbrown')).toBe('quick brown');
  });

  it('keeps the spaces at either end, which are part of what was asked for', () => {
    expect(normalizeQuery(' brown ')).toBe(' brown ');
  });
});

describe('findMatches', () => {
  it('ignores case', () => {
    expect(sliced([seg('The Quick Fox')], 'quick')).toEqual(['Quick']);
  });

  it('finds a phrase the source broke across a line', () => {
    expect(sliced([seg('the quick\nbrown fox')], 'quick brown')).toEqual(['quick\nbrown']);
  });

  it('finds a phrase the renderer split across inline markup', () => {
    // <p>the <em>quick</em> brown</p>
    expect(sliced([seg('the '), seg('quick'), seg(' brown')], 'quick brown')).toEqual(['quick brown']);
  });

  it('will not run the end of one block into the start of the next', () => {
    const segments = [seg('the fox'), seg('bar', true)];
    expect(sliced(segments, 'foxbar')).toEqual([]);
    expect(sliced(segments, 'fox bar')).toEqual([]);
  });

  it('returns offsets that cut the match back out of the original text', () => {
    const segments = [seg('alpha beta'), seg('gamma', true)];
    expect(sliced(segments, 'beta')).toEqual(['beta']);
    expect(sliced(segments, 'gamma')).toEqual(['gamma']);
  });

  it('does not drag the whitespace before a boundary into the match', () => {
    const segments = [seg('foo  '), seg('bar', true)];
    expect(sliced(segments, 'foo')).toEqual(['foo']);
  });

  it('covers the whole run of whitespace when the query asks for a space', () => {
    expect(sliced([seg('foo   bar')], 'foo bar')).toEqual(['foo   bar']);
  });

  it('folds the query too, so extra spaces in it still find the phrase', () => {
    expect(sliced([seg('foo bar')], 'foo    bar')).toEqual(['foo bar']);
  });

  it('finds every occurrence, in document order', () => {
    const index = buildSearchIndex([seg('ab ab ab')]);
    expect(findMatches(index, 'ab')).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ]);
  });

  it('does not let matches overlap', () => {
    expect(findMatches(buildSearchIndex([seg('aaaa')]), 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('finds nothing for an empty query', () => {
    expect(findMatches(buildSearchIndex([seg('anything')]), '')).toEqual([]);
  });

  it('stops at the limit rather than building a range per character', () => {
    expect(findMatches(buildSearchIndex([seg('a'.repeat(100))]), 'a', 10)).toHaveLength(10);
  });
});

describe('stepMatch', () => {
  it('walks forwards and backwards', () => {
    expect(stepMatch(5, 1, 1)).toBe(2);
    expect(stepMatch(5, 1, -1)).toBe(0);
  });

  it('wraps around at either end', () => {
    expect(stepMatch(5, 4, 1)).toBe(0);
    expect(stepMatch(5, 0, -1)).toBe(4);
  });

  it('starts at the first match going forwards and the last going backwards', () => {
    expect(stepMatch(5, -1, 1)).toBe(0);
    expect(stepMatch(5, -1, -1)).toBe(4);
  });

  it('points at nothing when there is nothing to point at', () => {
    expect(stepMatch(0, -1, 1)).toBe(-1);
  });
});

describe('matchLabel', () => {
  it('counts from one, the way a person does', () => {
    expect(matchLabel(7, 2, false)).toBe('3/7');
  });

  it('reads 0/0 when the query matches nothing', () => {
    expect(matchLabel(0, -1, false)).toBe('0/0');
  });

  it('marks a count that stopped at the limit', () => {
    expect(matchLabel(5000, 0, true)).toBe('1/5000+');
  });
});
