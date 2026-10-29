import { useAppStore } from '../store';
import type { Annotation } from './annotations';
import { forgetAnnotation, rebaseAnnotations, recordAnnotation } from './annotations-db';
import { remapToListNumbers, type TextSegment } from './list-numbers';

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

/**
 * Move annotations made before list numbers became text onto the text the
 * reader now shows. `segments` are its annotatable text nodes, numbers marked
 * (see `collectAnnotatableSegments`); the reader calls this once it has
 * rendered them, with the annotator held off until the hashes agree again.
 */
export function moveOntoListNumbers(segments: TextSegment[]): void {
  const { doc, annotations, rebaseAnnotations: settle, setError } = useAppStore.getState();
  if (!doc) return;
  const { kept, lost } = remapToListNumbers(annotations, segments);
  settle(kept, doc.contentHash);
  rebaseAnnotations(
    doc.id,
    doc.contentHash,
    kept,
    lost.map((a) => a.id),
  ).catch((e) => report('update the annotations', e));
  // Worded as opening words it: to the user this is the document opening, and
  // a quote that no longer matches is a document that changed.
  if (lost.length === 1) {
    setError('1 annotation discarded: this document has changed since it was made');
  } else if (lost.length > 1) {
    setError(`${lost.length} annotations discarded: this document has changed since they were made`);
  }
}
