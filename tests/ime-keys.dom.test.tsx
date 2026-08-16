// @vitest-environment jsdom

/**
 * The one place a DOM is worth starting for: what a browser actually dispatches
 * while an input method is composing.
 *
 * jsdom honours `KeyboardEventInit.isComposing`, so the sequence a CJK IME puts
 * on the wire — compositionstart, the pre-edit landing in the box, then an
 * Enter carrying `isComposing: true` / `keyCode: 229` — can be replayed here
 * verbatim. No amount of reasoning about `src/lib/keys.ts` in isolation would
 * have caught the React half of this (see below), which is exactly the part
 * that was wrong.
 *
 * See kb/notes/2026-08-16-ime-enter-escape.md.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationPopup } from '../src/components/AnnotationPopup';
import { isImeComposing, isSubmitEnter, watchComposition } from '../src/lib/keys';
import type { Annotation } from '../src/lib/annotations';
import type { AnnotationPopupState } from '../src/lib/use-text-annotator';

// What `main.tsx` installs for real. Without it the predicates fall back to
// reading the event alone, which is all a Chromium engine ever needs.
let stopWatching = () => {};
beforeEach(() => {
  stopWatching = watchComposition(document);
});
afterEach(() => {
  stopWatching();
  cleanup();
});

const PLACEMENT = { anchor: { top: 100, bottom: 120, left: 40 }, bounds: { width: 600, top: 0, bottom: 800 } };

const ANNOTATION: Annotation = {
  id: 'a1',
  quote: 'the quick brown fox',
  start: 10,
  end: 29,
  comment: 'existing',
  createdAt: 1,
  updatedAt: 1,
};

/** Enter as an IME sends it while composing: the key is Enter, the meaning is not. */
const COMPOSING_ENTER = { key: 'Enter', isComposing: true, keyCode: 229 };
const COMPOSING_ESCAPE = { key: 'Escape', isComposing: true, keyCode: 229 };

function renderPopup(popup: AnnotationPopupState, annotation?: Annotation) {
  const handlers = {
    onHighlight: vi.fn(),
    onAnnotate: vi.fn(),
    onDelete: vi.fn(),
    onSaveComment: vi.fn(),
    onDismiss: vi.fn(),
  };
  render(<AnnotationPopup popup={popup} annotation={annotation} {...handlers} />);
  return handlers;
}

/** Types into the comment box the way an IME does: pre-edit text, no commit. */
function compose(box: HTMLElement, text: string) {
  fireEvent.compositionStart(box);
  fireEvent.change(box, { target: { value: text } });
}

describe('the comment box while an IME is composing', () => {
  it('does not save the annotation when Enter commits the composition', async () => {
    const { onSaveComment, onDismiss } = renderPopup({ kind: 'view', annotationId: 'a1', ...PLACEMENT }, ANNOTATION);
    const box = screen.getByPlaceholderText('Add a comment…');

    compose(box, 'existing 中文');
    fireEvent.keyDown(box, COMPOSING_ENTER);

    // That Enter belongs to the input method: it turns the pre-edit into text
    // and leaves the caret where it was.
    expect(onSaveComment).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not throw the comment away when Escape drops the candidate', () => {
    const { onDismiss } = renderPopup({ kind: 'view', annotationId: 'a1', ...PLACEMENT }, ANNOTATION);
    const box = screen.getByPlaceholderText('Add a comment…');

    compose(box, 'existing 中文');
    fireEvent.keyDown(box, COMPOSING_ESCAPE);

    // Escape cancels the candidate, not the comment around it.
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not create the annotation when Enter commits inside a fresh draft', () => {
    const { onAnnotate, onDismiss } = renderPopup({ kind: 'draft', draftId: 'd1', ...PLACEMENT });
    fireEvent.click(screen.getByText('Annotate'));
    const box = screen.getByPlaceholderText('Add a comment…');

    compose(box, '中文');
    fireEvent.keyDown(box, COMPOSING_ENTER);

    expect(onAnnotate).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  /**
   * WebKit on macOS puts `compositionend` BEFORE the keydown that caused it, so
   * the Enter confirming a candidate arrives with `isComposing: false` and a
   * plain keyCode — nothing on the event says it was ever part of a
   * composition. Not a historical quirk: the preference that fixes the ordering
   * (`InputMethodUsesCorrectKeyEventOrder`, PLATFORM(MAC)) still defaults to
   * false on WebKit trunk, and mdnotate is a WKWebView. Reading the event alone
   * cannot catch this; only having watched the composition can.
   */
  it('does not save when WebKit puts compositionend before the confirming Enter', () => {
    const { onSaveComment, onDismiss } = renderPopup({ kind: 'view', annotationId: 'a1', ...PLACEMENT }, ANNOTATION);
    const box = screen.getByPlaceholderText('Add a comment…');

    compose(box, 'existing 中文');
    fireEvent.compositionEnd(box, { data: '中文' });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: false, keyCode: 13 });

    expect(onSaveComment).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not discard when WebKit puts compositionend before the confirming Escape', () => {
    const { onDismiss } = renderPopup({ kind: 'view', annotationId: 'a1', ...PLACEMENT }, ANNOTATION);
    const box = screen.getByPlaceholderText('Add a comment…');

    compose(box, 'existing 中文');
    fireEvent.compositionEnd(box, { data: '中文' });
    fireEvent.keyDown(box, { key: 'Escape', isComposing: false, keyCode: 27 });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('saves once the composition has settled and Enter means Enter again', async () => {
    const { onSaveComment, onDismiss } = renderPopup({ kind: 'view', annotationId: 'a1', ...PLACEMENT }, ANNOTATION);
    const box = screen.getByPlaceholderText('Add a comment…');

    compose(box, 'existing 中文');
    fireEvent.compositionEnd(box, { data: '中文' });
    // The window covers one key event, it does not hold the key hostage.
    await new Promise((resolve) => setTimeout(resolve, 80));
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(onSaveComment).toHaveBeenCalledWith('a1', 'existing 中文');
    expect(onDismiss).toHaveBeenCalled();
  });

  it('still dismisses on a plain Escape, and still takes Shift+Enter as a newline', () => {
    const { onDismiss, onSaveComment } = renderPopup({ kind: 'view', annotationId: 'a1', ...PLACEMENT }, ANNOTATION);
    const box = screen.getByPlaceholderText('Add a comment…');

    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSaveComment).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });
});

/**
 * Why `keys.ts` reaches past the synthetic event for the flag. If a future
 * React starts mirroring `isComposing` these turn red — read that as "the
 * detour is no longer needed", not as a defect.
 */
describe('what React hands a keydown handler', () => {
  function captureKeydown(init: KeyboardEventInit) {
    let seen: { synthetic: React.KeyboardEvent<HTMLInputElement>; submit: boolean } | null = null;
    cleanup(); // callable twice in one test, so keep a single input in the DOM
    render(<input onKeyDown={(e) => (seen = { synthetic: e, submit: isSubmitEnter(e) })} />);
    fireEvent.keyDown(screen.getByRole('textbox'), init);
    if (!seen) throw new Error('the keydown handler never ran');
    return seen as { synthetic: React.KeyboardEvent<HTMLInputElement>; submit: boolean };
  }

  it('leaves isComposing off the synthetic event, so a naive guard never fires', () => {
    const { synthetic } = captureKeydown(COMPOSING_ENTER);

    expect('isComposing' in synthetic).toBe(false);
    expect((synthetic as unknown as { isComposing?: boolean }).isComposing).toBeUndefined();
    // The flag is there — one level down.
    expect(synthetic.nativeEvent.isComposing).toBe(true);
    // And the legacy marker is mirrored, which is why it is worth reading.
    expect(synthetic.keyCode).toBe(229);
  });

  it('feeds the predicates correctly all the same', () => {
    expect(captureKeydown(COMPOSING_ENTER).submit).toBe(false);
    expect(captureKeydown({ key: 'Enter' }).submit).toBe(true);
  });
});

/** The other half: listeners on `document` get the native event itself. */
describe('what a document listener gets', () => {
  it('carries isComposing on the event, with no nativeEvent to reach for', () => {
    let seen: KeyboardEvent | null = null;
    const onKeyDown = (event: KeyboardEvent) => (seen = event);
    document.addEventListener('keydown', onKeyDown);
    render(<input />);
    fireEvent.keyDown(screen.getByRole('textbox'), COMPOSING_ESCAPE);
    document.removeEventListener('keydown', onKeyDown);

    const event = seen as unknown as KeyboardEvent;
    expect(event.isComposing).toBe(true);
    expect(isImeComposing(event)).toBe(true);
  });
});
