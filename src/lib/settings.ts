import { load } from '@tauri-apps/plugin-store';
import { isTauri } from './tauri-env';
import { DEFAULT_TEMPLATE } from './template';
import { clampTypographySettings, DEFAULT_TYPOGRAPHY, type TypographySettings } from './typography';

const STORE_FILE = 'settings.json';

export interface Settings {
  template: string;
  typography: TypographySettings;
}

export const DEFAULT_SETTINGS: Settings = {
  template: DEFAULT_TEMPLATE,
  typography: DEFAULT_TYPOGRAPHY,
};

/** Stored one entry per key, so writing one setting never rewrites the others. */
const KEYS = ['template', 'typography'] as const;

type StoredSettings = Partial<Record<keyof Settings, unknown>>;

/**
 * Build a complete Settings out of whatever was on disk. Every field is taken
 * on its own and validated: a hand-edited settings.json must never be able to
 * keep the reader shut.
 */
export function mergeSettings(stored: StoredSettings): Settings {
  return {
    template: typeof stored.template === 'string' ? stored.template : DEFAULT_SETTINGS.template,
    typography: clampTypographySettings(stored.typography),
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
