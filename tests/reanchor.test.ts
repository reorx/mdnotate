import { describe, expect, it } from 'vitest';
import type { Annotation } from '../src/lib/annotations';
import { reanchorAnnotations } from '../src/lib/reanchor';

/**
 * What happens to the highlights on a document the user has just edited and
 * saved. Offsets are positions in the rendered text, so every edit before an
 * annotation moves the words it points at; the quote is what lets it follow
 * them. Where the quote itself is gone, the annotation goes too — a highlight
 * on the wrong sentence is worse than none.
 */

function make(partial: Partial<Annotation> & Pick<Annotation, 'id' | 'quote' | 'start'>): Annotation {
  return {
    end: partial.start + partial.quote.length,
    comment: null,
    createdAt: 1000,
    updatedAt: 2000,
    ...partial,
  };
}

describe('reanchorAnnotations', () => {
  it('follows its quote when text is inserted before it', () => {
    const before = 'The quick brown fox jumps.';
    const after = 'Note: The quick brown fox jumps.';
    const fox = make({ id: 'a', quote: 'brown fox', start: before.indexOf('brown fox'), comment: 'nice' });

    const { kept, lost } = reanchorAnnotations([fox], after);

    expect(lost).toEqual([]);
    expect(kept).toEqual([
      { ...fox, start: after.indexOf('brown fox'), end: after.indexOf('brown fox') + 'brown fox'.length },
    ]);
  });

  it('keeps everything but the position: id, comment and both timestamps', () => {
    const fox = make({ id: 'a', quote: 'fox', start: 4, comment: 'why a fox?', createdAt: 11, updatedAt: 22 });
    const [moved] = reanchorAnnotations([fox], 'the red fox').kept;
    expect(moved).toMatchObject({ id: 'a', comment: 'why a fox?', createdAt: 11, updatedAt: 22, quote: 'fox' });
  });

  it('picks the occurrence nearest to where the quote used to be', () => {
    // "fox" three times; the annotation was on the middle one, at 20.
    const text = 'fox ............... fox ............... fox';
    const middle = make({ id: 'a', quote: 'fox', start: 21 });
    const [moved] = reanchorAnnotations([middle], text).kept;
    expect(moved.start).toBe(20);
  });

  it('gives up on an annotation whose quote no longer appears', () => {
    const fox = make({ id: 'a', quote: 'brown fox', start: 10 });
    const { kept, lost } = reanchorAnnotations([fox], 'The quick red fox jumps.');
    expect(kept).toEqual([]);
    expect(lost).toEqual([fox]);
  });

  it('gives up on an empty quote, which would match anywhere', () => {
    const empty = make({ id: 'a', quote: '', start: 3 });
    expect(reanchorAnnotations([empty], 'anything').lost).toEqual([empty]);
  });

  it('returns what it kept in document order', () => {
    const text = 'alpha beta gamma';
    const gamma = make({ id: 'g', quote: 'gamma', start: 0 });
    const alpha = make({ id: 'a', quote: 'alpha', start: 20 });
    expect(reanchorAnnotations([gamma, alpha], text).kept.map((a) => a.id)).toEqual(['a', 'g']);
  });

  it('sorts lost from kept independently, one annotation at a time', () => {
    const text = 'keep this sentence';
    const kept = make({ id: 'k', quote: 'this', start: 5 });
    const lost = make({ id: 'l', quote: 'deleted words', start: 12 });
    const result = reanchorAnnotations([kept, lost], text);
    expect(result.kept.map((a) => a.id)).toEqual(['k']);
    expect(result.lost.map((a) => a.id)).toEqual(['l']);
  });
});
