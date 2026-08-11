import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { House, PanelLeft, Settings, SquareArrowOutUpRight } from 'lucide-react';
import { openFilePath } from './lib/open-doc';
import { loadTemplate } from './lib/settings';
import { isTauri } from './lib/tauri-env';
import { useAppStore } from './store';
import { ExportView } from './components/ExportView';
import { Home } from './components/Home';
import { Reader } from './components/Reader';
import { SettingsView } from './components/SettingsView';
import './App.css';

function App() {
  const doc = useAppStore((s) => s.doc);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const annotationCount = useAppStore((s) => s.annotations.length);
  const setTemplate = useAppStore((s) => s.setTemplate);
  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);

  useEffect(() => {
    loadTemplate()
      .then(setTemplate)
      .catch(() => {});
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      // Register the listener before draining the pending file so a warm
      // open arriving in between is never lost.
      const stop = await listen<string>('open-file', (event) => {
        openFilePath(event.payload).catch((e) => setError(String(e)));
      });
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      const pending = await invoke<string | null>('take_pending_file');
      if (pending) await openFilePath(pending);
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setTemplate]);

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900">
      <header
        data-tauri-drag-region
        className={`flex h-9 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-2 ${isTauri ? 'pl-[72px]' : ''}`}
      >
        <button
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          title="Toggle table of contents"
          onClick={toggleSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          className={`rounded p-1 hover:bg-neutral-100 hover:text-neutral-800 ${
            view === 'home' ? 'text-neutral-800' : 'text-neutral-500'
          }`}
          title={view === 'home' && doc ? 'Back to the document' : 'Home'}
          onClick={() => setView(view === 'home' && doc ? 'reader' : 'home')}
        >
          <House className="h-4 w-4" />
        </button>
        {doc && (
          <span className="truncate text-[13px] font-medium text-neutral-700" title={doc.source}>
            {doc.title}
          </span>
        )}
        <div data-tauri-drag-region className="flex-1" />
        {doc && view === 'reader' && (
          <button
            className="flex items-center gap-1.5 rounded bg-amber-500 px-2.5 py-1 text-[13px] font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={annotationCount === 0}
            title={annotationCount === 0 ? 'Highlight some text first' : undefined}
            onClick={() => setView('export')}
          >
            <SquareArrowOutUpRight className="h-3.5 w-3.5" />
            Export Annotation
            {annotationCount > 0 && <span className="rounded bg-amber-600 px-1 text-[11px]">{annotationCount}</span>}
          </button>
        )}
        <button
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          title="Settings"
          onClick={() => setView(view === 'settings' ? 'reader' : 'settings')}
        >
          <Settings className="h-4 w-4" />
        </button>
      </header>

      {error && (
        <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-3 py-1 text-[12px] text-red-700">
          <span className="truncate">{error}</span>
          <button className="ml-2 shrink-0 underline" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {view === 'settings' ? (
        <SettingsView />
      ) : view === 'export' ? (
        <ExportView />
      ) : view === 'home' || !doc ? (
        <Home />
      ) : (
        <Reader />
      )}
    </div>
  );
}

export default App;
