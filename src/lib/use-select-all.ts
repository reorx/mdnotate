import { useEffect, useRef, type RefObject } from 'react';

/**
 * ⌘A means "select this document", not "select this window".
 *
 * Two things go wrong if it is left alone. The browser's own select-all reaches
 * the table of contents, the annotation list and the toolbar, so the copy that
 * usually follows brings all of it along. And the annotator library binds ⌘A
 * itself: its handler waits for the selection to land and then turns it into an
 * annotation, which means the shortcut for "copy this page" was offering to
 * highlight the whole document instead.
 *
 * Hence the capture phase. The library registers on the document in the
 * bubbling phase (hotkeys-js), so capturing on the document runs first and
 * `stopImmediatePropagation` takes the key away from it entirely — and does so
 * even while another view covers the reader, where a whole-document highlight
 * would be invisible as well as unwanted. `preventDefault` is the separate
 * decision: it is only ours to make when the reader is the thing on screen.
 */

export interface UseSelectAllOptions {
  /** What ⌘A should select — the prose, and nothing around it. */
  targetRef: RefObject<HTMLElement | null>;
  /** Off while the reader has no document, or is covered by another view. */
  enabled: boolean;
}

/** Somewhere the platform's own select-all is the right answer. */
function isTextBox(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function useSelectAll({ targetRef, enabled }: UseSelectAllOptions) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return;
      // Plain ⌘A only: ⇧⌘A arrives as the same key with shift held, and is
      // somebody else's shortcut.
      if (event.shiftKey) return;
      // The find box and the comment box each hold text of their own, and
      // selecting all of *that* is exactly what is being asked for.
      if (isTextBox(event.target)) return;

      event.stopImmediatePropagation();

      const el = targetRef.current;
      if (!enabledRef.current || !el) return;
      event.preventDefault();

      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
