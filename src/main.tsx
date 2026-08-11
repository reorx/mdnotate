import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyTheme, readCachedTheme, resolveTheme, systemPrefersDark } from './lib/theme';

// Before React paints anything. The stored preference sits behind an async IPC
// call, so without the cache every cold start flashes light first.
applyTheme(resolveTheme(readCachedTheme(), systemPrefersDark()));

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
