import { create } from 'zustand';
import { removeAnnotation, setAnnotationComment, upsertAnnotation, type Annotation } from './lib/annotations';
import { DEFAULT_TEMPLATE } from './lib/template';

export type View = 'reader' | 'export' | 'settings';

interface AppState {
  filePath: string | null;
  content: string | null;
  view: View;
  sidebarOpen: boolean;
  annotations: Annotation[];
  template: string;
  openFile: (filePath: string, content: string) => void;
  setView: (view: View) => void;
  toggleSidebar: () => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotationById: (id: string) => void;
  setComment: (id: string, comment: string | null) => void;
  setTemplate: (template: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  filePath: null,
  content: null,
  view: 'reader',
  sidebarOpen: true,
  annotations: [],
  template: DEFAULT_TEMPLATE,
  openFile: (filePath, content) => set({ filePath, content, annotations: [], view: 'reader' }),
  setView: (view) => set({ view }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  addAnnotation: (annotation) => set((s) => ({ annotations: upsertAnnotation(s.annotations, annotation) })),
  removeAnnotationById: (id) => set((s) => ({ annotations: removeAnnotation(s.annotations, id) })),
  setComment: (id, comment) =>
    set((s) => ({ annotations: setAnnotationComment(s.annotations, id, comment, Date.now()) })),
  setTemplate: (template) => set({ template }),
}));
