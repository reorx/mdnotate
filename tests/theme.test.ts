import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheTheme,
  clampTheme,
  DEFAULT_THEME,
  readCachedTheme,
  resolveTheme,
  THEME_PREFERENCES,
} from '../src/lib/theme';
import { mergeSettings } from '../src/lib/settings';

describe('clampTheme', () => {
  it('keeps every preference the settings view can produce', () => {
    for (const preference of THEME_PREFERENCES) {
      expect(clampTheme(preference)).toBe(preference);
    }
  });

  // A hand-edited settings.json must never be able to keep the reader shut.
  it('falls back to the default for anything else', () => {
    expect(clampTheme('DARK')).toBe(DEFAULT_THEME);
    expect(clampTheme('auto')).toBe(DEFAULT_THEME);
    expect(clampTheme(1)).toBe(DEFAULT_THEME);
    expect(clampTheme(null)).toBe(DEFAULT_THEME);
    expect(clampTheme(undefined)).toBe(DEFAULT_THEME);
    expect(clampTheme({ theme: 'dark' })).toBe(DEFAULT_THEME);
  });

  it('defaults to following the system', () => {
    expect(DEFAULT_THEME).toBe('system');
  });
});

describe('the boot cache', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
  });

  it('reads back what it wrote', () => {
    for (const preference of THEME_PREFERENCES) {
      cacheTheme(preference);
      expect(readCachedTheme()).toBe(preference);
    }
  });

  it('falls back to the default when nothing has been cached yet', () => {
    expect(readCachedTheme()).toBe(DEFAULT_THEME);
  });

  it('survives a corrupted entry instead of throwing', () => {
    localStorage.setItem('theme', '{not json');
    expect(readCachedTheme()).toBe(DEFAULT_THEME);
  });

  /*
   * The cache doubles as the whole store in the browser, where `settings.ts`
   * falls back to localStorage under this same key. If the two ever disagreed
   * about the encoding, a reload would read back a preference nobody wrote —
   * and the boot paint and the stored setting would drift apart.
   */
  it('uses the encoding the browser-mode settings store reads', () => {
    cacheTheme('dark');
    expect(mergeSettings({ theme: JSON.parse(localStorage.getItem('theme')!) }).theme).toBe('dark');
  });
});

describe('resolveTheme', () => {
  it('takes an explicit preference regardless of the system', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system when asked to', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
