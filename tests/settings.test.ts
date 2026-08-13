import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/lib/settings';
import { DEFAULT_TEMPLATE } from '../src/lib/template';

describe('mergeSettings', () => {
  it('returns the defaults for an empty store', () => {
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('takes each stored key on its own, leaving the others at their default', () => {
    const merged = mergeSettings({ template: '{{annotations}}' });
    expect(merged.template).toBe('{{annotations}}');
    expect(merged.typography).toEqual(DEFAULT_SETTINGS.typography);
  });

  it('fills in the format a stored typography object is missing', () => {
    const merged = mergeSettings({ typography: { markdown: { fontSize: 18, lineHeight: 1.8, width: 'full' } } });
    expect(merged.typography.markdown).toEqual({ fontSize: 18, lineHeight: 1.8, width: 'full' });
    expect(merged.typography.text).toEqual(DEFAULT_SETTINGS.typography.text);
  });

  it('keeps a stored theme preference', () => {
    expect(mergeSettings({ theme: 'dark' }).theme).toBe('dark');
  });

  it('keeps stored panel widths, clamped to their range', () => {
    expect(mergeSettings({ panels: { toc: 200, annotations: 9999 } }).panels).toEqual({
      toc: 200,
      annotations: 480,
    });
  });

  // A hand-edited settings.json must never be able to keep the reader shut.
  it('falls back for values of the wrong type instead of throwing', () => {
    const merged = mergeSettings({ template: 42, typography: 'large', theme: 'sepia', panels: 'wide' });
    expect(merged.template).toBe(DEFAULT_TEMPLATE);
    expect(merged.typography).toEqual(DEFAULT_SETTINGS.typography);
    expect(merged.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(merged.panels).toEqual(DEFAULT_SETTINGS.panels);
  });
});
