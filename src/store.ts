import { create } from 'zustand';
import { removeAnnotation, setAnnotationComment, upsertAnnotation, type Annotation } from './lib/annotations';
import type { OpenDoc } from './lib/recent-docs';
import { DEFAULT_SETTINGS, type Settings } from './lib/settings';

export type View = 'home' | 'reader' | 'export' | 'settings';

interface AppState {
  doc: OpenDoc | null;
  view: View;
  sidebarOpen: boolean;
  /** The annotation list on the right; hidden until there is something in it. */
  annotationsOpen: boolean;
  annotations: Annotation[];
  /** The persisted preferences, mirrored here so the UI reads them synchronously. */
  settings: Settings;
  /** Message for the banner under the toolbar; null when there is nothing wrong. */
  error: string | null;
  /** What is being fetched right now, shown in the toolbar; null when nothing is. */
  opening: string | null;
  openDoc: (doc: OpenDoc, annotations?: Annotation[]) => void;
  setError: (error: string | null) => void;
  setOpening: (opening: string | null) => void;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  toggleAnnotations: () => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotationById: (id: string) => void;
  setComment: (id: string, comment: string | null) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  doc: null,
  view: 'home',
  sidebarOpen: true,
  annotationsOpen: false,
  annotations: [],
  settings: DEFAULT_SETTINGS,
  error: null,
  opening: null,
  // A successful open clears whatever went wrong last time. Annotations arrive
  // with the document, not after it: the annotator seeds itself once, from what
  // the store holds the moment the reader mounts.
  openDoc: (doc, annotations = []) => set({ doc, annotations, view: 'reader', error: null }),
  setError: (error) => set({ error }),
  setOpening: (opening) => set({ opening }),
  setView: (view) => set({ view }),
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
}));
