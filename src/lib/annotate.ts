import { useAppStore } from '../store';
import type { Annotation } from './annotations';
import { forgetAnnotation, rebaseAnnotations, recordAnnotation } from './annotations-db';
import { remapToListNumbers, type TextSegment } from './list-numbers';
import { previewAnnotationImport, type AnnotationImportPreview } from './import-annotations';

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

export interface AnnotationImportResult {
  status: 'imported' | 'stale' | 'empty';
  saved: number;
  failed: number;
}

/**
 * Import is an explicit append through the same memory-first funnel as a mouse
 * highlight. Revalidate immediately before mutation, then capture the document
 * for every write: awaiting storage must never retarget a later document.
 * Reserving all IDs in memory before the first await also makes repeated
 * submissions deduplicate against the batch already in flight.
 *
 * Persistence is per row, as for ordinary annotation creation. There is no
 * transaction/rollback promise: return exact saved/failed counts and retain
 * failed rows on screen so the user can export them before leaving.
 */
export async function importAnnotations(
  preview: AnnotationImportPreview,
  readText: () => string | null,
): Promise<AnnotationImportResult> {
  const state = useAppStore.getState();
  const text = readText();
  if (
    state.doc !== preview.doc ||
    state.editing ||
    state.view !== 'reader' ||
    state.openDialog ||
    state.annotationsHash !== preview.doc.contentHash ||
    text === null ||
    text !== preview.text
  ) {
    return { status: 'stale', saved: 0, failed: 0 };
  }
  // Rechecking may demote a row, never promote one the user saw as skipped.
  const approved = new Set(preview.rows.filter((row) => row.status === 'ready').map((row) => row.number));
  const ready = previewAnnotationImport(preview.input, text, state.annotations).filter(
    (row) => row.status === 'ready' && approved.has(row.number),
  );
  if (!ready.length) return { status: 'empty', saved: 0, failed: 0 };
  const now = Date.now();
  const added: Annotation[] = ready.map((row) => ({
    id: crypto.randomUUID(),
    quote: row.quote,
    comment: row.comment,
    start: row.start!,
    end: row.end!,
    createdAt: now,
    updatedAt: now,
  }));
  for (const annotation of added) state.addAnnotation(annotation);
  const results = await Promise.allSettled(
    added.map((annotation) => recordAnnotation(preview.doc.id, preview.doc.contentHash, annotation)),
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) {
    const reason = failures[0] as PromiseRejectedResult;
    report(
      'save imported annotations',
      `${failures.length} of ${added.length} not saved; export them before leaving. ${reason.reason}`,
    );
  }
  return { status: 'imported', saved: added.length - failures.length, failed: failures.length };
}
