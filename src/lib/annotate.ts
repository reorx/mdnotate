import { useAppStore } from '../store';
import type { Annotation } from './annotations';
import { forgetAnnotation, recordAnnotation } from './annotations-db';

/**
 * The one way an annotation changes. Like `open-doc`, the store is written
 * first and the database after: the highlight is on screen the moment the user
 * asks for it, and a storage failure is reported rather than thrown, because by
 * then there is nothing left to cancel.
 */

function report(action: string, error: unknown): void {
  useAppStore.getState().setError(`Could not ${action}: ${error}`);
}

/** Persist whatever the store now holds for this annotation. */
function persist(id: string): void {
  const { doc, annotations } = useAppStore.getState();
  const annotation = annotations.find((a) => a.id === id);
  if (!doc || !annotation) return;
  recordAnnotation(doc.id, doc.contentHash, annotation).catch((e) => report('save the annotation', e));
}

export function createAnnotation(annotation: Annotation): void {
  useAppStore.getState().addAnnotation(annotation);
  persist(annotation.id);
}

export function updateComment(id: string, comment: string | null): void {
  useAppStore.getState().setComment(id, comment);
  persist(id);
}

export function deleteAnnotation(id: string): void {
  useAppStore.getState().removeAnnotationById(id);
  forgetAnnotation(id).catch((e) => report('delete the annotation', e));
}
