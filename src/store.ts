import { create } from 'zustand';
import { removeAnnotation, setAnnotationComment, upsertAnnotation, type Annotation } from './lib/annotations';
import type { OpenDoc } from './lib/recent-docs';
import { DEFAULT_SETTINGS, type Settings } from './lib/settings';
import { readCachedTheme, resolveTheme, systemPrefersDark, type ResolvedTheme } from './lib/theme';

export type View = 'home' | 'reader' | 'export' | 'settings';

interface AppState {
  doc: OpenDoc | null;
  view: View;
  sidebarOpen: boolean;
  /** The annotation list on the right; hidden until there is something in it. */
  annotationsOpen: boolean;
  /**
   * The ⌘O panel. It covers everything, the header included, so it is a switch
   * alongside `view` rather than a fifth view of its own.
   */
  openDialog: boolean;
  annotations: Annotation[];
  /**
   * The content hash the annotations' offsets were measured on. The same as
   * `doc.contentHash` except in the moment after a save, when the text has
   * changed and the annotations have yet to be moved onto it — the reader keeps
   * the annotator off until the two agree again, or it would paint old offsets
   * over new prose.
   */
  annotationsHash: string | null;
  /** The document is shown in the code editor rather than rendered. */
  editing: boolean;
  /** The editor holds text that differs from what was last read or saved. */
  dirty: boolean;
  /** The persisted preferences, mirrored here so the UI reads them synchronously. */
  settings: Settings;
  /**
   * `settings.theme` with `system` already resolved. Derived, but kept here
   * because the OS half of it is only observed in one effect, and the parts
   * that need it — the highlight blending, the note under the theme picker —
   * are nowhere near that effect.
   */
  resolvedTheme: ResolvedTheme;
  /** Message for the banner under the toolbar; null when there is nothing wrong. */
  error: string | null;
  /** What is being fetched right now, shown in the toolbar; null when nothing is. */
  opening: string | null;
  openDoc: (doc: OpenDoc, annotations?: Annotation[]) => void;
  setEditing: (editing: boolean) => void;
  setDirty: (dirty: boolean) => void;
  /** The text just written to disk becomes the document's text. */
  applySave: (saved: { content: string; contentHash: string; modifiedAt?: number }) => void;
  /** Annotations moved onto the text whose hash is given. */
  rebaseAnnotations: (annotations: Annotation[], hash: string) => void;
  setError: (error: string | null) => void;
  setOpening: (opening: string | null) => void;
  setView: (view: View) => void;
  setOpenDialog: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleAnnotations: () => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotationById: (id: string) => void;
  setComment: (id: string, comment: string | null) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setResolvedTheme: (theme: ResolvedTheme) => void;
}

/**
 * The theme is the one setting that cannot wait for `loadSettings()`: the whole
 * window is painted in it, and the effect that keeps it in sync writes the
 * current value back to the cache. Seeded from the default, that effect would
 * put `system` over the stored preference before the stored preference had even
 * been read — which in the browser, where the cache *is* the store, loses it for
 * good. So the store starts where `main.tsx` already painted: at the cache.
 */
const cachedTheme = readCachedTheme();

export const useAppStore = create<AppState>((set) => ({
  doc: null,
  view: 'home',
  sidebarOpen: true,
  annotationsOpen: false,
  openDialog: false,
  annotations: [],
  annotationsHash: null,
  editing: false,
  dirty: false,
  settings: { ...DEFAULT_SETTINGS, theme: cachedTheme },
  resolvedTheme: resolveTheme(cachedTheme, systemPrefersDark()),
  error: null,
  opening: null,
  // A successful open clears whatever went wrong last time. Annotations arrive
  // with the document, not after it: the annotator seeds itself once, from what
  // the store holds the moment the reader mounts.
  //
  // Closing the ⌘O panel here is the whole of that rule: every way into a
  // document — a pasted path, the two halves of one, the clipboard, a recents
  // entry, the system dialog, a file dragged in, even one double-clicked in
  // Finder while the panel is up — ends in this one call, so none of them has
  // to remember to get the panel out of the way.
  //
  // So is going back to reading: a document always opens rendered, and any
  // edits to the one before it were saved or let go before it got this far
  // (see `edit-session`).
  openDoc: (doc, annotations = []) =>
    set({
      doc,
      annotations,
      annotationsHash: doc.contentHash,
      editing: false,
      dirty: false,
      view: 'reader',
      error: null,
      openDialog: false,
    }),
  // Leaving the editor throws its text away, so nothing is unsaved any more.
  setEditing: (editing) => set(editing ? { editing } : { editing, dirty: false }),
  setDirty: (dirty) => set({ dirty }),
  // The annotations are left exactly as they are: their offsets still belong
  // to the old text, and `annotationsHash` says so until they are re-anchored.
  applySave: ({ content, contentHash, modifiedAt }) =>
    set((s) => (s.doc ? { doc: { ...s.doc, content, contentHash, modifiedAt }, dirty: false } : {})),
  rebaseAnnotations: (annotations, annotationsHash) => set({ annotations, annotationsHash }),
  setError: (error) => set({ error }),
  setOpening: (opening) => set({ opening }),
  setView: (view) => set({ view }),
  setOpenDialog: (openDialog) => set({ openDialog }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleAnnotations: () => set((s) => ({ annotationsOpen: !s.annotationsOpen })),
  // Making an annotation is what reveals the list: an empty panel is worth no
  // screen width, and the first highlight is the moment it becomes worth some.
  addAnnotation: (annotation) =>
    set((s) => ({ annotations: upsertAnnotation(s.annotations, annotation), annotationsOpen: true })),
  removeAnnotationById: (id) => set((s) => ({ annotations: removeAnnotation(s.annotations, id) })),
  setComment: (id, comment) =>
    set((s) => ({ annotations: setAnnotationComment(s.annotations, id, comment, Date.now()) })),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
}));
