import { describe, expect, it } from 'vitest';
import {
  annotationsToMarkdown,
  removeAnnotation,
  setAnnotationComment,
  sortAnnotations,
  upsertAnnotation,
  type Annotation,
} from '../src/lib/annotations';

function make(partial: Partial<Annotation> & Pick<Annotation, 'id' | 'start'>): Annotation {
  return {
    quote: `quote-${partial.id}`,
    end: partial.start + 10,
    comment: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

describe('annotation list operations', () => {
  it('sorts annotations by document position', () => {
    const list = [make({ id: 'b', start: 50 }), make({ id: 'a', start: 10 })];
    expect(sortAnnotations(list).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('upsert inserts a new annotation keeping order', () => {
    const list = [make({ id: 'a', start: 10 }), make({ id: 'c', start: 90 })];
    const next = upsertAnnotation(list, make({ id: 'b', start: 50 }));
    expect(next.map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });

  it('upsert replaces an existing annotation with the same id', () => {
    const list = [make({ id: 'a', start: 10 })];
    const next = upsertAnnotation(list, make({ id: 'a', start: 10, comment: 'edited' }));
    expect(next).toHaveLength(1);
    expect(next[0].comment).toBe('edited');
  });

  it('remove drops the annotation by id and leaves others untouched', () => {
    const list = [make({ id: 'a', start: 10 }), make({ id: 'b', start: 50 })];
    expect(removeAnnotation(list, 'a').map((a) => a.id)).toEqual(['b']);
  });

  it('setAnnotationComment updates comment and updatedAt only for the target', () => {
    const list = [make({ id: 'a', start: 10 }), make({ id: 'b', start: 50 })];
    const next = setAnnotationComment(list, 'a', 'hello', 2000);
    expect(next[0].comment).toBe('hello');
    expect(next[0].updatedAt).toBe(2000);
    expect(next[1].comment).toBeNull();
    expect(next[1].updatedAt).toBe(1000);
  });

  it('setAnnotationComment with null turns an annotation back into a plain highlight', () => {
    const list = [make({ id: 'a', start: 10, comment: 'x' })];
    expect(setAnnotationComment(list, 'a', null, 2000)[0].comment).toBeNull();
  });
});

describe('annotationsToMarkdown', () => {
  it('renders a highlight with comment as blockquote followed by the comment', () => {
    const list = [make({ id: 'a', start: 10, quote: 'some quoted text', comment: 'my thought' })];
    expect(annotationsToMarkdown(list)).toBe('> some quoted text\n\nmy thought');
  });

  it('renders a pure highlight as a blockquote only', () => {
    const list = [make({ id: 'a', start: 10, quote: 'just highlighted' })];
    expect(annotationsToMarkdown(list)).toBe('> just highlighted');
  });

  it('joins multiple annotations with blank lines, in document order', () => {
    const list = [
      make({ id: 'b', start: 50, quote: 'second', comment: 'note two' }),
      make({ id: 'a', start: 10, quote: 'first' }),
    ];
    expect(annotationsToMarkdown(list)).toBe('> first\n\n> second\n\nnote two');
  });

  it('prefixes every line of a multi-line quote with "> "', () => {
    const list = [make({ id: 'a', start: 10, quote: 'line one\nline two', comment: 'c' })];
    expect(annotationsToMarkdown(list)).toBe('> line one\n> line two\n\nc');
  });

  it('returns an empty string for no annotations', () => {
    expect(annotationsToMarkdown([])).toBe('');
  });
});
