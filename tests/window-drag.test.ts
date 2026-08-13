import { describe, expect, it } from 'vitest';
import { isWindowDragMousedown } from '../src/lib/window-drag';

function target(attr: string | null): Pick<HTMLElement, 'getAttribute'> {
  return { getAttribute: (name: string) => (name === 'data-tauri-drag-region' ? attr : null) };
}

const md = (over: Partial<{ button: number; detail: number; attr: string | null }> = {}) => ({
  button: over.button ?? 0,
  detail: over.detail ?? 1,
  target: target(over.attr !== undefined ? over.attr : ''),
});

describe('isWindowDragMousedown', () => {
  it('accepts a primary single click on a bare drag-region element', () => {
    expect(isWindowDragMousedown(md())).toBe(true);
    expect(isWindowDragMousedown(md({ attr: 'true' }))).toBe(true);
  });

  it('rejects clicks on elements without the drag-region attribute', () => {
    expect(isWindowDragMousedown(md({ attr: null }))).toBe(false);
  });

  it('rejects explicitly disabled drag regions', () => {
    expect(isWindowDragMousedown(md({ attr: 'false' }))).toBe(false);
  });

  it('rejects non-primary buttons', () => {
    expect(isWindowDragMousedown(md({ button: 1 }))).toBe(false);
    expect(isWindowDragMousedown(md({ button: 2 }))).toBe(false);
  });

  it('rejects double clicks so drag.js keeps handling maximize', () => {
    expect(isWindowDragMousedown(md({ detail: 2 }))).toBe(false);
  });

  it('rejects targets that are not elements', () => {
    expect(isWindowDragMousedown({ button: 0, detail: 1, target: null })).toBe(false);
  });
});
