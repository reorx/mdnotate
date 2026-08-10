/** True when running inside the Tauri webview (vs a plain browser in dev). */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
