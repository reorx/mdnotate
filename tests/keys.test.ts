import { describe, expect, it } from 'vitest';
import { isCancelEscape, isImeComposing, isSubmitEnter } from '../src/lib/keys';

/** As React hands it over: the flag is only on `nativeEvent`. */
function synthetic(key: string, native: { isComposing?: boolean; keyCode?: number } = {}, shiftKey = false) {
  return {
    key,
    shiftKey,
    keyCode: native.keyCode ?? 0,
    nativeEvent: { isComposing: false, keyCode: 0, ...native },
  };
}

/** As a `document` listener gets it: the flag is on the event itself. */
function native(key: string, extra: { isComposing?: boolean; keyCode?: number } = {}, shiftKey = false) {
  return { key, shiftKey, isComposing: false, keyCode: 0, ...extra };
}

describe('isImeComposing', () => {
  it('finds the flag under a synthetic event', () => {
    expect(isImeComposing(synthetic('Enter', { isComposing: true }))).toBe(true);
    expect(isImeComposing(synthetic('Enter'))).toBe(false);
  });

  it('finds it on a native event, which has no nativeEvent to look under', () => {
    expect(isImeComposing(native('Escape', { isComposing: true }))).toBe(true);
    expect(isImeComposing(native('Escape'))).toBe(false);
  });

  it('takes keyCode 229 as composing too, from either shape', () => {
    expect(isImeComposing(synthetic('Enter', { keyCode: 229 }))).toBe(true);
    expect(isImeComposing(native('Enter', { keyCode: 229 }))).toBe(true);
  });

  it('says nothing about which key it was', () => {
    expect(isImeComposing(synthetic('ArrowDown', { isComposing: true }))).toBe(true);
    expect(isImeComposing(synthetic('a'))).toBe(false);
  });
});

describe('isSubmitEnter', () => {
  it('is a bare Enter and nothing else', () => {
    expect(isSubmitEnter(synthetic('Enter'))).toBe(true);
    expect(isSubmitEnter(native('Enter'))).toBe(true);
    expect(isSubmitEnter(synthetic('Escape'))).toBe(false);
  });

  it('is not the Enter that commits a composition', () => {
    expect(isSubmitEnter(synthetic('Enter', { isComposing: true }))).toBe(false);
    expect(isSubmitEnter(synthetic('Enter', { keyCode: 229 }))).toBe(false);
    expect(isSubmitEnter(native('Enter', { isComposing: true }))).toBe(false);
  });

  it('leaves Shift+Enter to mean a newline', () => {
    expect(isSubmitEnter(synthetic('Enter', {}, true))).toBe(false);
  });
});

describe('isCancelEscape', () => {
  it('is a bare Escape, from either shape', () => {
    expect(isCancelEscape(synthetic('Escape'))).toBe(true);
    expect(isCancelEscape(native('Escape'))).toBe(true);
    expect(isCancelEscape(synthetic('Enter'))).toBe(false);
  });

  it('is not the Escape that drops a candidate', () => {
    expect(isCancelEscape(synthetic('Escape', { isComposing: true }))).toBe(false);
    expect(isCancelEscape(synthetic('Escape', { keyCode: 229 }))).toBe(false);
    expect(isCancelEscape(native('Escape', { keyCode: 229 }))).toBe(false);
  });

  // Escape is a lone key wherever it is bound; a modifier held with it means
  // somebody else's shortcut, and holding one does not stop it being a cancel.
  it('does not care about Shift', () => {
    expect(isCancelEscape(synthetic('Escape', {}, true))).toBe(true);
  });
});
