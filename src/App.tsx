import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  BookOpen,
  House,
  LoaderCircle,
  PanelLeft,
  PanelRight,
  Pencil,
  RotateCw,
  Settings,
  SquareArrowOutUpRight,
} from 'lucide-react';
import { confirmLeaveEdits, startEditing, stopEditing } from './lib/edit-session';
import { openSpec, reloadDoc } from './lib/open-doc';
import { describeEdit, describeReload } from './lib/recent-docs';
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
import { OpenDialog } from './components/OpenDialog';
import { Reader } from './components/Reader';
import { SettingsView } from './components/SettingsView';
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
  const openDialog = useAppStore((s) => s.openDialog);
  const setOpenDialog = useAppStore((s) => s.setOpenDialog);
  const editing = useAppStore((s) => s.editing);

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
      // Register the listeners before draining the pending document so a warm
      // open arriving in between is never lost.
      const stops = [
        await listen<string>('open-doc', (event) => {
          openSpec(event.payload).catch((e) => setError(String(e)));
        }),
        // File ▸ Open… asks for the panel rather than opening anything itself:
        // what a document may be named, and how it is reached, is decided here.
        await listen('open-dialog', () => setOpenDialog(true)),
      ];
      const stopAll = () => stops.forEach((stop) => stop());
      if (cancelled) {
        stopAll();
        return;
      }
      unlisten = stopAll;
      const pending = await invoke<string | null>('take_pending_doc');
      if (pending) await openSpec(pending);
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [updateSettings, setOpenDialog]);

  // Closing the window is one more way out of the editor, so it asks first
  // when there is something unsaved (and quitting, which closes every window,
  // asks in each). Only listened for while editing: a close request with a
  // listener is held until the page lets it go, and a window that is only
  // being read has no reason to make one wait on it.
  useEffect(() => {
    if (!isTauri || !editing) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (!(await confirmLeaveEdits())) event.preventDefault();
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [editing, setError]);

  const reload = describeReload(doc);
  const edit = describeEdit(doc);

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
        inert={openDialog}
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
        {/* One button for both ways: it stays where it is and changes colour,
            so the way back is always under the pointer that came in. The View
            side is the ramp's darkest, which turns light in dark mode. */}
        {doc && view === 'reader' &&
          (editing ? (
            <button
              className="flex items-center gap-1.5 rounded bg-neutral-800 px-2.5 py-1 text-[13px] font-medium text-page hover:bg-neutral-700"
              title="Back to the rendered document"
              onClick={() => stopEditing().catch((e) => setError(String(e)))}
            >
              <BookOpen className="h-3.5 w-3.5" />
              View
            </button>
          ) : (
            <button
              className="flex items-center gap-1.5 rounded bg-sky-600 px-2.5 py-1 text-[13px] font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40 dark:disabled:opacity-25"
              disabled={!edit.canEdit}
              title={edit.title}
              onClick={startEditing}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          ))}
        {/* Greyed rather than hidden while editing, so the button beside it
            does not shift: the annotations are about the saved text, and may
            yet move when it is saved again. */}
        {doc && view === 'reader' && (
          <button
            className="flex items-center gap-1.5 rounded bg-amber-500 px-2.5 py-1 text-[13px] font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40 dark:disabled:opacity-25"
            disabled={annotationCount === 0 || editing}
            title={
              editing ? 'Switch to View to export' : annotationCount === 0 ? 'Highlight some text first' : undefined
            }
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

      <div className="relative flex min-h-0 flex-1 flex-col" inert={openDialog}>
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

      {/* Over everything, the header included — hence a switch of its own
          rather than another `view`. */}
      {openDialog && <OpenDialog />}
    </div>
  );
}

export default App;
