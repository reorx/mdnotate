import { describe, expect, it } from 'vitest';
import {
  annotationPreview,
  annotationsToMarkdown,
  removeAnnotation,
  setAnnotationComment,
  sortAnnotations,
  splitStaleAnnotations,
  upsertAnnotation,
  type Annotation,
  type StoredAnnotation,
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

function stored(
  partial: Partial<StoredAnnotation> & Pick<StoredAnnotation, 'id' | 'start' | 'docHash'>,
): StoredAnnotation {
  return { ...make(partial), docHash: partial.docHash };
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

describe('splitStaleAnnotations', () => {
  it('restores annotations made on the same content, in document order', () => {
    const rows = [stored({ id: 'b', start: 50, docHash: 'h1' }), stored({ id: 'a', start: 10, docHash: 'h1' })];
    const { fresh, stale } = splitStaleAnnotations(rows, 'h1');
    expect(fresh.map((a) => a.id)).toEqual(['a', 'b']);
    expect(stale).toEqual([]);
  });

  it('drops annotations anchored to an earlier version of the document', () => {
    const rows = [stored({ id: 'old', start: 10, docHash: 'h1' }), stored({ id: 'new', start: 50, docHash: 'h2' })];
    const { fresh, stale } = splitStaleAnnotations(rows, 'h2');
    expect(fresh.map((a) => a.id)).toEqual(['new']);
    expect(stale.map((a) => a.id)).toEqual(['old']);
  });

  it('drops every annotation when the document has changed entirely', () => {
    const rows = [stored({ id: 'a', start: 10, docHash: 'h1' }), stored({ id: 'b', start: 50, docHash: 'h1' })];
    const { fresh, stale } = splitStaleAnnotations(rows, 'h2');
    expect(fresh).toEqual([]);
    expect(stale).toHaveLength(2);
  });

  it('strips the stored hash, so what reaches the reader is a plain annotation', () => {
    const { fresh } = splitStaleAnnotations([stored({ id: 'a', start: 10, docHash: 'h1' })], 'h1');
    expect(fresh[0]).not.toHaveProperty('docHash');
    expect(fresh[0]).toEqual(make({ id: 'a', start: 10 }));
  });

  it('carries comments through unchanged', () => {
    const rows = [stored({ id: 'a', start: 10, docHash: 'h1', comment: 'my thought' })];
    expect(splitStaleAnnotations(rows, 'h1').fresh[0].comment).toBe('my thought');
  });

  it('returns nothing for a document that has never been annotated', () => {
    expect(splitStaleAnnotations([], 'h1')).toEqual({ fresh: [], stale: [] });
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

describe('annotationPreview', () => {
  it('leaves a plain one-line quote as it is', () => {
    expect(annotationPreview('some quoted text')).toBe('some quoted text');
  });

  it('folds line breaks into single spaces so the entry stays on its lines', () => {
    expect(annotationPreview('line one\nline two')).toBe('line one line two');
  });

  it('collapses runs of whitespace left by the rendered markup', () => {
    expect(annotationPreview('a  \n\n  b\tc')).toBe('a b c');
  });

  it('trims the edges', () => {
    expect(annotationPreview('\n  padded  \n')).toBe('padded');
  });

  it('returns an empty string for whitespace only', () => {
    expect(annotationPreview('   \n\t ')).toBe('');
  });
});
