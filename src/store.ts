import { create } from 'zustand';
import { removeAnnotation, setAnnotationComment, upsertAnnotation, type Annotation } from './lib/annotations';
import type { OpenDoc } from './lib/recent-docs';
import { DEFAULT_TEMPLATE } from './lib/template';

export type View = 'home' | 'reader' | 'export' | 'settings';

interface AppState {
  doc: OpenDoc | null;
  view: View;
  sidebarOpen: boolean;
  annotations: Annotation[];
  template: string;
  /** Message for the banner under the toolbar; null when there is nothing wrong. */
  error: string | null;
  openDoc: (doc: OpenDoc, annotations?: Annotation[]) => void;
  setError: (error: string | null) => void;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotationById: (id: string) => void;
  setComment: (id: string, comment: string | null) => void;
  setTemplate: (template: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  doc: null,
  view: 'home',
  sidebarOpen: true,
  annotations: [],
  template: DEFAULT_TEMPLATE,
  error: null,
  // A successful open clears whatever went wrong last time. Annotations arrive
  // with the document, not after it: the annotator seeds itself once, from what
  // the store holds the moment the reader mounts.
  openDoc: (doc, annotations = []) => set({ doc, annotations, view: 'reader', error: null }),
  setError: (error) => set({ error }),
  setView: (view) => set({ view }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  addAnnotation: (annotation) => set((s) => ({ annotations: upsertAnnotation(s.annotations, annotation) })),
  removeAnnotationById: (id) => set((s) => ({ annotations: removeAnnotation(s.annotations, id) })),
  setComment: (id, comment) =>
    set((s) => ({ annotations: setAnnotationComment(s.annotations, id, comment, Date.now()) })),
  setTemplate: (template) => set({ template }),
}));
