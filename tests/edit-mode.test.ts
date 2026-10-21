// @vitest-environment jsdom

/**
 * The store's half of editing: which flags an open resets, and what a save
 * changes — and, as importantly, what it leaves alone.
 *
 * The one to keep in mind is `annotationsHash`. A save replaces the text, but
 * the annotations in the store still carry offsets measured on the old text
 * until they have been re-anchored; the reader holds the annotator off for as
 * long as the two hashes differ. A save that also bumped `annotationsHash`
 * would let the annotator paint the old offsets over the new prose.
 *
 * jsdom for the same reason as `open-dialog.test.ts`: the store reads the
 * cached theme and `matchMedia` while it is being imported.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});

import { useAppStore } from '../src/store';
import type { Annotation } from '../src/lib/annotations';
import type { OpenDoc } from '../src/lib/recent-docs';

const DOC: OpenDoc = {
  id: 'file:/tmp/a.md',
  kind: 'file',
  title: 'a.md',
  source: '/tmp/a.md',
  content: 'old text',
  format: 'markdown',
  contentHash: 'old-hash',
  modifiedAt: 100,
};

const NOTE: Annotation = { id: 'n', quote: 'text', start: 4, end: 8, comment: null, createdAt: 1, updatedAt: 1 };

describe('edit mode in the store', () => {
  beforeEach(() => {
    useAppStore.setState({
      doc: null,
      view: 'home',
      annotations: [],
      editing: false,
      dirty: false,
      annotationsHash: null,
    });
  });

  it('starts out reading, with nothing unsaved', () => {
    const { editing, dirty } = useAppStore.getState();
    expect(editing).toBe(false);
    expect(dirty).toBe(false);
  });

  it('opens every document for reading, whatever the window was doing before', () => {
    useAppStore.setState({ editing: true, dirty: true });
    useAppStore.getState().openDoc(DOC, [NOTE]);
    const { editing, dirty, annotationsHash } = useAppStore.getState();
    expect(editing).toBe(false);
    expect(dirty).toBe(false);
    expect(annotationsHash).toBe('old-hash');
  });

  it('forgets unsaved changes when editing ends', () => {
    useAppStore.getState().openDoc(DOC);
    useAppStore.getState().setEditing(true);
    useAppStore.getState().setDirty(true);
    useAppStore.getState().setEditing(false);
    expect(useAppStore.getState().dirty).toBe(false);
  });

  it('takes a save as the new document text, and counts nothing as unsaved after it', () => {
    useAppStore.getState().openDoc(DOC, [NOTE]);
    useAppStore.setState({ editing: true, dirty: true });

    useAppStore.getState().applySave({ content: 'new old text', contentHash: 'new-hash', modifiedAt: 200 });

    const { doc, dirty, editing } = useAppStore.getState();
    expect(doc).toMatchObject({ content: 'new old text', contentHash: 'new-hash', modifiedAt: 200, id: DOC.id });
    expect(dirty).toBe(false);
    expect(editing).toBe(true);
  });

  it('leaves the annotations, and the hash they were measured on, for re-anchoring to move', () => {
    useAppStore.getState().openDoc(DOC, [NOTE]);
    useAppStore.getState().applySave({ content: 'new old text', contentHash: 'new-hash', modifiedAt: 200 });

    const { annotations, annotationsHash } = useAppStore.getState();
    expect(annotations).toEqual([NOTE]);
    expect(annotationsHash).toBe('old-hash');
  });

  it('settles the annotations on the new text once they have been moved', () => {
    useAppStore.getState().openDoc(DOC, [NOTE]);
    useAppStore.getState().applySave({ content: 'new old text', contentHash: 'new-hash', modifiedAt: 200 });

    const moved = { ...NOTE, start: 8, end: 12 };
    useAppStore.getState().rebaseAnnotations([moved], 'new-hash');

    const { annotations, annotationsHash } = useAppStore.getState();
    expect(annotations).toEqual([moved]);
    expect(annotationsHash).toBe('new-hash');
  });
});
