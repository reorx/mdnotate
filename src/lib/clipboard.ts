import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { isTauri } from './tauri-env';

/**
 * Current clipboard text, or null when it holds nothing readable.
 *
 * In plain-browser dev this needs the page to be focused and the user to have
 * granted clipboard access, so it fails far more often than in the app — the
 * caller treats a rejection the same as an empty clipboard.
 */
export async function readClipboardText(): Promise<string | null> {
  const text = isTauri ? await readText() : await navigator.clipboard.readText();
  return text || null;
}

/** Put text on the clipboard, through whichever of the two APIs is available. */
export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri) await writeText(text);
  else await navigator.clipboard.writeText(text);
}
