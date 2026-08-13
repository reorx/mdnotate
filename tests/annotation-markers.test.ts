import { describe, expect, it } from 'vitest';
import { commentMarkers, sameMarkers, type MarkerRect } from '../src/lib/annotation-markers';
import type { Annotation } from '../src/lib/annotations';

function make(partial: Partial<Annotation> & Pick<Annotation, 'id'>): Annotation {
  return {
    quote: `quote-${partial.id}`,
    start: 0,
    end: 10,
    comment: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

function rect(top: number, left: number, width = 100, height = 20): MarkerRect {
  return { top, left, width, height };
}

describe('commentMarkers', () => {
  it('marks a commented highlight at the right edge of its line, vertically centred', () => {
    const rects = new Map([['a', [rect(40, 10, 100, 20)]]]);
    expect(commentMarkers([make({ id: 'a', comment: 'note' })], rects)).toEqual([{ id: 'a', left: 110, top: 50 }]);
  });

  it('leaves a plain highlight unmarked', () => {
    const rects = new Map([['a', [rect(40, 10)]]]);
    expect(commentMarkers([make({ id: 'a' })], rects)).toEqual([]);
  });

  it('leaves an empty comment unmarked, as the rest of the UI reads it', () => {
    const rects = new Map([['a', [rect(40, 10)]]]);
    expect(commentMarkers([make({ id: 'a', comment: '' })], rects)).toEqual([]);
  });

  it('hangs the marker off the last line of a highlight that wraps', () => {
    const rects = new Map([['a', [rect(40, 200, 100), rect(60, 0, 50), rect(80, 0, 30)]]]);
    expect(commentMarkers([make({ id: 'a', comment: 'note' })], rects)).toEqual([{ id: 'a', left: 30, top: 90 }]);
  });

  it('finds the last line by position, not by the order the rectangles arrive in', () => {
    const rects = new Map([['a', [rect(80, 0, 30), rect(40, 200, 100)]]]);
    expect(commentMarkers([make({ id: 'a', comment: 'note' })], rects)).toEqual([{ id: 'a', left: 30, top: 90 }]);
  });

  it('takes the rightmost of several rectangles sharing the last line', () => {
    // Inline code and the like break one visual line into rectangles of
    // slightly different heights, so their tops do not match exactly.
    const rects = new Map([['a', [rect(60, 0, 40, 20), rect(58, 40, 30, 24), rect(60, 70, 25, 20)]]]);
    expect(commentMarkers([make({ id: 'a', comment: 'note' })], rects)[0].left).toBe(95);
  });

  it('skips an annotation the renderer has not painted', () => {
    expect(commentMarkers([make({ id: 'a', comment: 'note' })], new Map())).toEqual([]);
    expect(commentMarkers([make({ id: 'a', comment: 'note' })], new Map([['a', []]]))).toEqual([]);
  });

  it('keeps the order it was given, which is document order', () => {
    const rects = new Map([
      ['a', [rect(10, 0)]],
      ['b', [rect(90, 0)]],
    ]);
    const list = [make({ id: 'a', comment: 'first' }), make({ id: 'b', comment: 'second' })];
    expect(commentMarkers(list, rects).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('rounds to a tenth of a pixel, so sub-pixel jitter is not a new position', () => {
    const rects = new Map([['a', [rect(40.006, 10.004, 100, 21)]]]);
    expect(commentMarkers([make({ id: 'a', comment: 'note' })], rects)).toEqual([{ id: 'a', left: 110, top: 50.5 }]);
  });

  it('returns nothing for a document without annotations', () => {
    expect(commentMarkers([], new Map())).toEqual([]);
  });
});

describe('sameMarkers', () => {
  it('accepts two identical sets', () => {
    const a = [{ id: 'a', left: 10, top: 20 }];
    expect(sameMarkers(a, [{ id: 'a', left: 10, top: 20 }])).toBe(true);
  });

  it('rejects a marker that moved', () => {
    expect(sameMarkers([{ id: 'a', left: 10, top: 20 }], [{ id: 'a', left: 10, top: 21 }])).toBe(false);
  });

  it('rejects a different set of annotations', () => {
    expect(sameMarkers([{ id: 'a', left: 10, top: 20 }], [{ id: 'b', left: 10, top: 20 }])).toBe(false);
    expect(sameMarkers([{ id: 'a', left: 10, top: 20 }], [])).toBe(false);
  });

  it('accepts two empty sets', () => {
    expect(sameMarkers([], [])).toBe(true);
  });
});
