import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { FileText, FolderOpen, PanelLeft, Settings, SquareArrowOutUpRight } from 'lucide-react';
import { SAMPLE_DOC, SAMPLE_DOC_PATH } from './lib/sample-doc';
import { loadTemplate } from './lib/settings';
import { isTauri } from './lib/tauri-env';
import { useAppStore } from './store';
import { ExportView } from './components/ExportView';
import { Reader } from './components/Reader';
import { SettingsView } from './components/SettingsView';
import './App.css';

async function openPath(path: string) {
  const content = await invoke<string>('read_markdown_file', { path });
  useAppStore.getState().openFile(path, content);
}

async function openFileDialog() {
  const path = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (typeof path === 'string') await openPath(path);
}

function App() {
  const filePath = useAppStore((s) => s.filePath);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const annotationCount = useAppStore((s) => s.annotations.length);
  const setTemplate = useAppStore((s) => s.setTemplate);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTemplate()
      .then(setTemplate)
      .catch(() => {});
    if (!isTauri) {
      // Plain-browser dev mode: no backend, load a sample document.
      if (import.meta.env.DEV) {
        useAppStore.getState().openFile(SAMPLE_DOC_PATH, SAMPLE_DOC);
      }
      return;
    }
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      // Register the listener before draining the pending file so a warm
      // open arriving in between is never lost.
      const stop = await listen<string>('open-file', (event) => {
        openPath(event.payload).catch((e) => setError(String(e)));
      });
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      const pending = await invoke<string | null>('take_pending_file');
      if (pending) await openPath(pending);
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setTemplate]);

  const fileName = filePath?.split('/').pop() ?? null;

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900">
      <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-2">
        <button
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          title="Toggle table of contents"
          onClick={toggleSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          title="Open file…"
          onClick={() => openFileDialog().catch((e) => setError(String(e)))}
        >
          <FolderOpen className="h-4 w-4" />
        </button>
        {fileName && (
          <span className="truncate text-[13px] font-medium text-neutral-700" title={filePath ?? ''}>
            {fileName}
          </span>
        )}
        <div className="flex-1" />
        {filePath && view === 'reader' && (
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
      ) : filePath ? (
        <Reader />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-neutral-400">
          <FileText className="h-10 w-10" />
          <p className="text-sm">
            Open a Markdown file to start reading — or set mdnotate as the default app for <code>.md</code> files.
          </p>
          <button
            className="rounded bg-amber-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-amber-600"
            onClick={() => openFileDialog().catch((e) => setError(String(e)))}
          >
            Open File…
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
