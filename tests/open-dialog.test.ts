// @vitest-environment jsdom

/**
 * The one rule holding the ⌘O panel together.
 *
 * Nothing in the panel closes it: not the path box, not the prefix pair, not
 * the clipboard card, not a recents entry, not the system dialog, and not a
 * file double-clicked in Finder while it is up. Every one of them ends in
 * `openDoc`, and `openDoc` is where the panel gets out of the way. Break that
 * line and the document opens behind a panel that stays on screen — with no
 * component-level code anywhere to say why.
 *
 * jsdom rather than node only because the store is a browser module: it reads
 * the cached theme out of `localStorage` and asks `matchMedia` what the system
 * prefers, both at import time. `tests/ime-keys.dom.test.tsx` is still the only
 * *component* test there is.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has `localStorage` but no `matchMedia`, and the store asks for both
// while it is being imported. Hoisted, so it is in place before it is.
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
});

import { useAppStore } from '../src/store';
import type { OpenDoc } from '../src/lib/recent-docs';

const DOC: OpenDoc = {
  id: 'file:/tmp/a.md',
  kind: 'file',
  title: 'a.md',
  source: '/tmp/a.md',
  content: '# a',
  format: 'markdown',
  contentHash: 'abc',
};

describe('the ⌘O panel', () => {
  beforeEach(() => {
    useAppStore.setState({ doc: null, view: 'home', openDialog: false, annotations: [] });
  });

  it('starts closed', () => {
    expect(useAppStore.getState().openDialog).toBe(false);
  });

  it('opens and closes on request', () => {
    useAppStore.getState().setOpenDialog(true);
    expect(useAppStore.getState().openDialog).toBe(true);
    useAppStore.getState().setOpenDialog(false);
    expect(useAppStore.getState().openDialog).toBe(false);
  });

  it('gets out of the way of a document, whichever way in it came', () => {
    useAppStore.getState().setOpenDialog(true);
    useAppStore.getState().openDoc(DOC);

    const state = useAppStore.getState();
    expect(state.openDialog).toBe(false);
    expect(state.doc).toEqual(DOC);
    expect(state.view).toBe('reader');
  });
});
