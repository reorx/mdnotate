import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { House, LoaderCircle, PanelLeft, PanelRight, RotateCw, Settings, SquareArrowOutUpRight } from 'lucide-react';
import { openSpec, reloadDoc } from './lib/open-doc';
import { describeReload } from './lib/recent-docs';
import { loadSettings } from './lib/settings';
import { isTauri } from './lib/tauri-env';
import {
  applyTheme,
  cacheTheme,
  resolveTheme,
  syncWindowTheme,
  systemPrefersDark,
  watchSystemTheme,
} from './lib/theme';
import { useAppStore, type View } from './store';
import { DocTitle } from './components/DocTitle';
import { ExportView } from './components/ExportView';
import { Home } from './components/Home';
import { Reader } from './components/Reader';
import { SettingsView } from './components/SettingsView';
import 'katex/dist/katex.min.css';
import './App.css';
import './find-highlight.css';

function App() {
  const doc = useAppStore((s) => s.doc);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const toggleAnnotations = useAppStore((s) => s.toggleAnnotations);
  const annotationCount = useAppStore((s) => s.annotations.length);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const theme = useAppStore((s) => s.settings.theme);
  const setResolvedTheme = useAppStore((s) => s.setResolvedTheme);
  const error = useAppStore((s) => s.error);
  const setError = useAppStore((s) => s.setError);
  const opening = useAppStore((s) => s.opening);

  // The whole of the theme's effect on the world: the class on <html>, the
  // window's own appearance, and the cache the next cold start reads. Runs
  // again on every OS change, which only alters anything while the preference
  // is `system` — `resolveTheme` ignores the query otherwise.
  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme, systemPrefersDark());
      applyTheme(resolved);
      setResolvedTheme(resolved);
    };
    apply();
    cacheTheme(theme);
    syncWindowTheme(theme).catch(() => {});
    return watchSystemTheme(apply);
  }, [theme, setResolvedTheme]);

  useEffect(() => {
    loadSettings()
      .then(updateSettings)
      .catch(() => {});
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      // Register the listener before draining the pending document so a warm
      // open arriving in between is never lost.
      const stop = await listen<string>('open-doc', (event) => {
        openSpec(event.payload).catch((e) => setError(String(e)));
      });
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      const pending = await invoke<string | null>('take_pending_doc');
      if (pending) await openSpec(pending);
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [updateSettings]);

  const reload = describeReload(doc);

  // Everything other than the reader is laid over it instead of replacing it:
  // the reader keeps its scroll position, its annotator and its rendered
  // markdown, so a trip to export or settings comes back to the same page.
  const overlay: Exclude<View, 'reader'> | null = view === 'reader' ? (doc ? null : 'home') : view;

  return (
    <div className="flex h-screen flex-col bg-page text-neutral-900">
      {/* `z-30`, because the document-info panel hangs out of the header and
          into the row below it. Both that row and the header are positioned
          with no z-index of their own, so without this the later sibling — the
          reader — paints over anything reaching down into it. */}
      <header
        data-tauri-drag-region
        className={`relative z-30 flex h-9 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-2 ${isTauri ? 'pl-[72px]' : ''}`}
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
        {/* Only while the reader is the thing on top: it re-reads the document
            you are looking at, and putting the document back on screen is what
            an open does — pressed from settings or export it would throw you
            out of them. */}
        {doc && view === 'reader' && (
          <button
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:disabled:opacity-25"
            disabled={!reload.canReload}
            title={reload.title}
            onClick={() => reloadDoc(doc).catch((e) => setError(String(e)))}
          >
            <RotateCw className="h-4 w-4" />
          </button>
        )}
        {doc && <DocTitle doc={doc} />}
        {opening && (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-neutral-500" title={opening}>
            <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">Opening {opening}</span>
          </span>
        )}
        <div data-tauri-drag-region className="flex-1" />
        {doc && view === 'reader' && (
          <button
            className="flex items-center gap-1.5 rounded bg-amber-500 px-2.5 py-1 text-[13px] font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40 dark:disabled:opacity-25"
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
        <button
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          title="Toggle annotations"
          onClick={toggleAnnotations}
        >
          <PanelRight className="h-4 w-4" />
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

      <div className="relative flex min-h-0 flex-1 flex-col">
        {doc && (
          // Still rendered while covered, so `inert` keeps it out of the tab
          // order and away from screen readers until it is on top again.
          <div className="flex min-h-0 flex-1" inert={!!overlay}>
            <Reader />
          </div>
        )}
        {overlay && (
          <div className="absolute inset-0 z-10 flex flex-col bg-page">
            {overlay === 'settings' ? <SettingsView /> : overlay === 'export' ? <ExportView /> : <Home />}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
