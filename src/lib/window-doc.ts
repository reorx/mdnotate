import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAppStore } from '../store';
import { isTauri } from './tauri-env';

/** What a window with nothing in it is called, as in the window config. */
const APP_TITLE = 'mdnotate';

/**
 * Say which document this window holds.
 *
 * It is what the next document opened from outside is routed by: a window
 * already showing it is raised rather than opening a second copy — two copies
 * would write annotations to the same rows while showing each other nothing —
 * and a window still on the home screen is filled rather than pushed aside.
 * macOS wants the title for the same reason, in the Window menu and Mission
 * Control, where the app's own header is not on show.
 *
 * The store is read rather than passed in, so that an open which came to
 * nothing can put the truth back without knowing what was there before.
 */
export function announceDoc(): void {
  if (!isTauri) return;
  const { doc } = useAppStore.getState();
  invoke('set_window_doc', { docId: doc?.id ?? null }).catch(() => {});
  getCurrentWindow()
    .setTitle(doc?.title ?? APP_TITLE)
    .catch(() => {});
}
