// @vitest-environment jsdom

/**
 * Opening a document whose annotations were made before list numbers became
 * text: they arrive measured against the old text, the reader holds the
 * annotator off, and once the new text is on screen they are moved onto it —
 * in the store first, then in the database.
 *
 * jsdom only because the store is a browser module (see `open-dialog.test.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});

vi.mock('../src/lib/annotations-db', () => ({
  rebaseAnnotations: vi.fn(async () => {}),
  recordAnnotation: vi.fn(async () => {}),
  forgetAnnotation: vi.fn(async () => {}),
}));

import { useAppStore } from '../src/store';
import { rebaseAnnotations } from '../src/lib/annotations-db';
import { moveOntoListNumbers } from '../src/lib/annotate';
import type { Annotation } from '../src/lib/annotations';
import type { TextSegment } from '../src/lib/list-numbers';
import type { OpenDoc } from '../src/lib/recent-docs';

const DOC: OpenDoc = {
  id: 'file:/tmp/a.md',
  kind: 'file',
  title: 'a.md',
  source: '/tmp/a.md',
  content: '1. apple\n2. banana\n',
  format: 'markdown',
  contentHash: 'h:list-numbers-v1',
};

// Before: "apple\nbanana"   After: "1. apple\n2. banana"
const SEGMENTS: TextSegment[] = [
  { text: '1. ', listNumber: true },
  { text: 'apple', listNumber: false },
  { text: '\n', listNumber: false },
  { text: '2. ', listNumber: true },
  { text: 'banana', listNumber: false },
];

const banana: Annotation = { id: 'b', quote: 'banana', start: 6, end: 12, comment: 'yum', createdAt: 1, updatedAt: 1 };
const gone: Annotation = { id: 'g', quote: 'cherry', start: 0, end: 6, comment: null, createdAt: 1, updatedAt: 1 };

describe('moving annotations onto the numbered text', () => {
  beforeEach(() => {
    vi.mocked(rebaseAnnotations).mockClear();
    useAppStore.setState({ doc: null, annotations: [], annotationsHash: null, error: null });
  });

  it('opens with the annotations still counted in the old text', () => {
    useAppStore.getState().openDoc(DOC, [banana], 'h');
    expect(useAppStore.getState().annotationsHash).toBe('h');
  });

  it('opens a document whose annotations need no moving as before', () => {
    useAppStore.getState().openDoc(DOC, [banana]);
    expect(useAppStore.getState().annotationsHash).toBe(DOC.contentHash);
  });

  it('moves them, and the annotator may then come back', () => {
    useAppStore.getState().openDoc(DOC, [banana], 'h');
    moveOntoListNumbers(SEGMENTS);
    const { annotations, annotationsHash } = useAppStore.getState();
    expect(annotations).toEqual([{ ...banana, start: 12, end: 18 }]);
    expect(annotationsHash).toBe(DOC.contentHash);
  });

  it('stores the moved ones and forgets the ones it could not place', () => {
    useAppStore.getState().openDoc(DOC, [banana, gone], 'h');
    moveOntoListNumbers(SEGMENTS);
    expect(rebaseAnnotations).toHaveBeenCalledWith(DOC.id, DOC.contentHash, [{ ...banana, start: 12, end: 18 }], ['g']);
  });

  it('says how many it had to give up on', () => {
    useAppStore.getState().openDoc(DOC, [banana, gone], 'h');
    moveOntoListNumbers(SEGMENTS);
    expect(useAppStore.getState().error).toBe('1 annotation discarded: this document has changed since it was made');
  });

  it('says nothing when every annotation found its place', () => {
    useAppStore.getState().openDoc(DOC, [banana], 'h');
    moveOntoListNumbers(SEGMENTS);
    expect(useAppStore.getState().error).toBeNull();
  });
});
