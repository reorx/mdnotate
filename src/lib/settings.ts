import { load } from '@tauri-apps/plugin-store';
import { clampPanelWidths, DEFAULT_PANEL_WIDTHS, type PanelWidths } from './panels';
import { isTauri } from './tauri-env';
import { DEFAULT_ANNOTATION_TEMPLATE, DEFAULT_TEMPLATE } from './template';
import { clampTheme, DEFAULT_THEME, type ThemePreference } from './theme';
import { clampTypographySettings, DEFAULT_TYPOGRAPHY, type TypographySettings } from './typography';

const STORE_FILE = 'settings.json';

export interface Settings {
  /** The document as a whole. */
  template: string;
  /** One annotation within it. */
  annotationTemplate: string;
  typography: TypographySettings;
  theme: ThemePreference;
  panels: PanelWidths;
  /**
   * A directory the `mdnotate` command was installed into by hand. Remembered
   * only so it can be looked in again: the two directories the card offers are
   * constants both sides already know, but one the user typed is nowhere to be
   * found afterwards, and the command would read as uninstalled next time.
   */
  cliInstallDir: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  template: DEFAULT_TEMPLATE,
  annotationTemplate: DEFAULT_ANNOTATION_TEMPLATE,
  typography: DEFAULT_TYPOGRAPHY,
  theme: DEFAULT_THEME,
  panels: DEFAULT_PANEL_WIDTHS,
  cliInstallDir: null,
};

/** Stored one entry per key, so writing one setting never rewrites the others. */
const KEYS = ['template', 'annotationTemplate', 'typography', 'theme', 'panels', 'cliInstallDir'] as const;

type StoredSettings = Partial<Record<keyof Settings, unknown>>;

/**
 * Build a complete Settings out of whatever was on disk. Every field is taken
 * on its own and validated: a hand-edited settings.json must never be able to
 * keep the reader shut.
 */
export function mergeSettings(stored: StoredSettings): Settings {
  return {
    template: typeof stored.template === 'string' ? stored.template : DEFAULT_SETTINGS.template,
    annotationTemplate:
      typeof stored.annotationTemplate === 'string' ? stored.annotationTemplate : DEFAULT_SETTINGS.annotationTemplate,
    typography: clampTypographySettings(stored.typography),
    theme: clampTheme(stored.theme),
    panels: clampPanelWidths(stored.panels),
    // Only ever written as a full path, so anything else is not a directory we
    // could look in — and a relative one would be resolved against wherever the
    // app happens to have been launched from.
    cliInstallDir:
      typeof stored.cliInstallDir === 'string' && stored.cliInstallDir.startsWith('/') ? stored.cliInstallDir : null,
  };
}

// The browser fallback stores JSON like the Tauri store does. Anything else in
// there is something we did not write, and is worth exactly as much as nothing.
function readLocal(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function readStored(): Promise<StoredSettings> {
  if (!isTauri) {
    return Object.fromEntries(KEYS.map((key) => [key, readLocal(key)]));
  }
  const store = await load(STORE_FILE, { autoSave: true });
  const entries = await Promise.all(KEYS.map(async (key) => [key, await store.get(key)] as const));
  return Object.fromEntries(entries);
}

export async function loadSettings(): Promise<Settings> {
  return mergeSettings(await readStored());
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const entries = Object.entries(patch);
  if (!isTauri) {
    for (const [key, value] of entries) localStorage.setItem(key, JSON.stringify(value));
    return;
  }
  const store = await load(STORE_FILE, { autoSave: true });
  for (const [key, value] of entries) await store.set(key, value);
}
