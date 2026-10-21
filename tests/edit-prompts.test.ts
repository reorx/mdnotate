import { describe, expect, it } from 'vitest';
import { saveChoiceOf } from '../src/lib/edit-prompts';

/**
 * The Save / Don't Save / Cancel alert answers with either the standard button
 * name or the label it was given, depending on the platform's dialog backend.
 * Anything unrecognised — Escape, a closed sheet — must read as Cancel: the
 * one answer that loses nothing.
 */
describe('saveChoiceOf', () => {
  it('reads Save from either spelling', () => {
    expect(saveChoiceOf('Yes')).toBe('save');
    expect(saveChoiceOf('Save')).toBe('save');
  });

  it('reads Don’t Save from either spelling', () => {
    expect(saveChoiceOf('No')).toBe('discard');
    expect(saveChoiceOf("Don't Save")).toBe('discard');
  });

  it('reads Cancel, and anything it does not recognise, as cancel', () => {
    expect(saveChoiceOf('Cancel')).toBe('cancel');
    expect(saveChoiceOf('Ok')).toBe('cancel');
    expect(saveChoiceOf('')).toBe('cancel');
  });
});
