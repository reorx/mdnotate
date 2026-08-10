import { load } from '@tauri-apps/plugin-store';
import { isTauri } from './tauri-env';
import { DEFAULT_TEMPLATE } from './template';

const STORE_FILE = 'settings.json';
const TEMPLATE_KEY = 'template';

export async function loadTemplate(): Promise<string> {
  if (!isTauri) {
    return localStorage.getItem(TEMPLATE_KEY) ?? DEFAULT_TEMPLATE;
  }
  const store = await load(STORE_FILE, { autoSave: true });
  return (await store.get<string>(TEMPLATE_KEY)) ?? DEFAULT_TEMPLATE;
}

export async function saveTemplate(template: string): Promise<void> {
  if (!isTauri) {
    localStorage.setItem(TEMPLATE_KEY, template);
    return;
  }
  const store = await load(STORE_FILE, { autoSave: true });
  await store.set(TEMPLATE_KEY, template);
}
