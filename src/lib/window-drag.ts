import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauri-env';

/**
 * Workaround for window dragging on macOS 26: tauri's own drag handling
 * (`data-tauri-drag-region` → async `start_dragging` command → user message to
 * the event loop) runs so late that `NSApp.currentEvent` is already a
 * LeftMouseDragged, and Tahoe's `performWindowDragWithEvent:` silently ignores
 * anything but a live LeftMouseDown. Our `start_window_drag` command is
 * synchronous, so it executes on the main thread while the mousedown is still
 * the current event and hands the window a freshly synthesized one.
 */

interface DragMousedown {
  button: number;
  detail: number;
  target: Pick<HTMLElement, 'getAttribute'> | EventTarget | null;
}

/** Mirrors drag.js's bare-attribute semantics: primary single click landing
 * directly on an element marked `data-tauri-drag-region`. Double clicks stay
 * with drag.js, which turns them into maximize. */
export function isWindowDragMousedown(e: DragMousedown): boolean {
  if (e.button !== 0 || e.detail !== 1) return false;
  if (!e.target || typeof (e.target as HTMLElement).getAttribute !== 'function') return false;
  const attr = (e.target as HTMLElement).getAttribute('data-tauri-drag-region');
  return attr === '' || attr === 'true';
}

/** Capture-phase so drag.js's stopImmediatePropagation cannot starve it. */
export function installWindowDrag(): void {
  if (!isTauri) return;
  document.addEventListener(
    'mousedown',
    (e) => {
      if (isWindowDragMousedown(e)) {
        invoke('start_window_drag').catch(() => {});
      }
    },
    true,
  );
}
