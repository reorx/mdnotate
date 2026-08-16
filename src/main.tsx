import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { watchComposition } from './lib/keys';
import { applyTheme, readCachedTheme, resolveTheme, systemPrefersDark } from './lib/theme';
import { installWindowDrag } from './lib/window-drag';

// Before React paints anything. The stored preference sits behind an async IPC
// call, so without the cache every cold start flashes light first.
applyTheme(resolveTheme(readCachedTheme(), systemPrefersDark()));

installWindowDrag();

// Also before the first keystroke: on WKWebView the event alone cannot say
// whether an Enter belongs to the input method (see `lib/keys.ts`).
watchComposition();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
