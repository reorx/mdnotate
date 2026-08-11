import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from './tauri-env';

/** What the user picked in Settings. `system` defers the choice to the OS. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What the window is actually painted in — `system` already resolved. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

export const DEFAULT_THEME: ThemePreference = 'system';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Mirror of the preference in a store that can be read synchronously at boot.
 * The real one lives behind an async IPC call, so without this the window is
 * painted light for a frame or two on every cold start.
 *
 * The key and the JSON encoding are the ones `settings.ts` uses for its browser
 * fallback on purpose: in the browser this cache *is* the stored setting, and
 * the two paths can never disagree about what is written there.
 */
const CACHE_KEY = 'theme';

export function clampTheme(raw: unknown): ThemePreference {
  return THEME_PREFERENCES.includes(raw as ThemePreference) ? (raw as ThemePreference) : DEFAULT_THEME;
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference !== 'system') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Only meaningful while the preference is `system`: an explicit preference is
 * pushed down to the window (see `syncWindowTheme`), which flips the webview's
 * `prefers-color-scheme` along with it. `system` sets the window theme back to
 * null, so the query means what its name says exactly when we consult it.
 */
export function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/**
 * The one place the theme reaches the page. `.dark` drives the stylesheet;
 * `color-scheme` drives what the stylesheet cannot reach — scrollbars, the
 * caret, range tracks and the rest of the native widgets.
 */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

export function cacheTheme(preference: ThemePreference): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(preference));
}

export function readCachedTheme(): ThemePreference {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw === null) return DEFAULT_THEME;
  try {
    return clampTheme(JSON.parse(raw));
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Hand the preference to the window itself, so the native half of the app —
 * scroll bars, context menus, the text selection menu, the traffic lights —
 * matches the half we paint. `null` is how Tauri spells "follow the system".
 */
export async function syncWindowTheme(preference: ThemePreference): Promise<void> {
  if (!isTauri) return;
  await getCurrentWindow().setTheme(preference === 'system' ? null : preference);
}
