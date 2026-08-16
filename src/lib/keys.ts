/**
 * What a keypress means, once the input method has had its share.
 *
 * A browser keeps dispatching `keydown` while a CJK input method is composing,
 * because the input method needs those keys: Enter turns the pre-edit text into
 * real text, Escape drops the candidate, the arrows walk the candidate list.
 * They arrive as `key: 'Enter'`, `key: 'Escape'`, `key: 'ArrowDown'` like any
 * other, so a handler that only reads `key` acts on keys that were never meant
 * for it — saving half a sentence and closing the box it was being typed into.
 *
 * Nobody writing in English ever sees it, which is why the wrong version is the
 * one that gets written. Hence a single place to be right: never compare
 * `event.key` in a keydown handler that gives a key a meaning of its own — come
 * through here instead.
 *
 * See kb/notes/2026-08-16-ime-enter-escape.md.
 */

/**
 * A keydown from either side of React. The flag lives in different places
 * depending on where the handler is attached, and this is the whole reason the
 * module exists:
 *
 * - a listener on `document` gets the native event, which carries `isComposing`
 * - a React `onKeyDown` gets a synthetic event, which does **not** — the
 *   property is absent from the object as well as from the type, so
 *   `!e.isComposing` reads as `true` forever and the guard silently does
 *   nothing. It has to be taken off `nativeEvent`.
 */
export interface KeydownLike {
  key: string;
  shiftKey: boolean;
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}

/**
 * What browsers reported before `isComposing` existed, and what some input
 * methods still report. Cheap to keep, and the only thing standing between us
 * and a silent regression on whichever engine is behind today's webview.
 */
const COMPOSING_KEY_CODE = 229;

/**
 * How long after `compositionend` a keypress is still treated as the input
 * method's. Long enough to cover the key event WebKit delivers second (they
 * come from one native event, microseconds apart), short enough that nobody
 * can type a deliberate Enter inside it.
 */
const SETTLING_MS = 50;

/** Composing, or close enough behind it to still be the same keystroke. */
let settling = false;
let settled: ReturnType<typeof setTimeout> | undefined;

/**
 * Watches composition on the document, and it is not optional here.
 *
 * On every Chromium engine the flag on the event is enough: the Enter that
 * confirms a candidate arrives as `keydown` first, carrying `isComposing`, and
 * `compositionend` follows. **WebKit on macOS does it the other way round** —
 * `compositionend` fires first, so that same Enter arrives with
 * `isComposing: false` and an ordinary keyCode, indistinguishable from an Enter
 * the user meant. Nothing on the event can tell them apart; only having seen
 * the composition end a moment ago can.
 *
 * This is current behaviour rather than history: WebKit's fix for the ordering
 * sits behind `InputMethodUsesCorrectKeyEventOrder` (PLATFORM(MAC)), which was
 * switched back off in June 2026 and still defaults to false on trunk. mdnotate
 * is a WKWebView, so this is the only engine that matters to us.
 *
 * Called once from `main.tsx`, before React renders — the listener has to be in
 * place before the first keystroke. The teardown exists for tests.
 */
export function watchComposition(target: Document = document): () => void {
  const started = () => {
    clearTimeout(settled);
    settling = true;
  };
  const ended = () => {
    clearTimeout(settled);
    settled = setTimeout(() => {
      settling = false;
    }, SETTLING_MS);
  };
  // Capture, so it is recorded before any handler asks about it.
  target.addEventListener('compositionstart', started, true);
  target.addEventListener('compositionend', ended, true);
  return () => {
    clearTimeout(settled);
    settling = false;
    target.removeEventListener('compositionstart', started, true);
    target.removeEventListener('compositionend', ended, true);
  };
}

/** True while the keypress belongs to the input method rather than to us. */
export function isImeComposing(event: KeydownLike): boolean {
  // With `nativeEvent` it is React's, without it it is the DOM's own.
  const source = event.nativeEvent ?? event;
  if (source.isComposing === true || source.keyCode === COMPOSING_KEY_CODE) return true;
  // Nothing on the event, which on WebKit means nothing yet — see above.
  return settling;
}

/** Enter meaning "done" — not "commit the candidate", and not Shift+Enter. */
export function isSubmitEnter(event: KeydownLike): boolean {
  return event.key === 'Enter' && !event.shiftKey && !isImeComposing(event);
}

/** Escape meaning "close this" — not "drop the candidate". */
export function isCancelEscape(event: KeydownLike): boolean {
  return event.key === 'Escape' && !isImeComposing(event);
}
