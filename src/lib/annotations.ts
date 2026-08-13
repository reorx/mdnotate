import type { TextAnnotation } from '@recogito/text-annotator';
import { renderAnnotationTemplate } from './template';

/**
 * One user annotation on the document. A highlight and a comment are the same
 * structure — a highlight is simply an annotation whose `comment` is null; the
 * UI distinguishes them, the data layer never does.
 */
export interface Annotation {
  id: string;
  quote: string;
  /** Character offsets over the rendered text of the reader container. */
  start: number;
  end: number;
  /** null = pure highlight; a string = highlighted with a comment. */
  comment: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * An annotation as it comes back from storage, tagged with the document content
 * it was anchored to.
 */
export interface StoredAnnotation extends Annotation {
  /** Hash of the document text the offsets were measured against. */
  docHash: string;
}

const COMMENT_PURPOSE = 'commenting';

export function toRecogitoAnnotation(annotation: Annotation): TextAnnotation {
  return {
    id: annotation.id,
    bodies:
      annotation.comment === null
        ? []
        : [
            {
              id: `${annotation.id}#comment`,
              annotation: annotation.id,
              purpose: COMMENT_PURPOSE,
              value: annotation.comment,
            },
          ],
    target: {
      annotation: annotation.id,
      selector: [{ quote: annotation.quote, start: annotation.start, end: annotation.end }],
    },
  };
}

export function fromRecogitoAnnotation(annotation: TextAnnotation, now: number): Annotation | null {
  const selector = annotation.target.selector.find((s) => typeof s.start === 'number' && typeof s.end === 'number');
  if (!selector) return null;
  const comment = annotation.bodies.find((b) => b.purpose === COMMENT_PURPOSE)?.value ?? null;
  return {
    id: annotation.id,
    quote: selector.quote,
    start: selector.start,
    end: selector.end,
    comment,
    createdAt: now,
    updatedAt: now,
  };
}

export function sortAnnotations(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Sort stored annotations into the ones that still belong to this document and
 * the ones that no longer do.
 *
 * Offsets are measured over the rendered text, so an annotation made on
 * different content would point at whatever words now happen to sit at those
 * positions. Rather than highlight the wrong sentence, annotations whose hash
 * does not match are given up on.
 */
export function splitStaleAnnotations(
  rows: StoredAnnotation[],
  docHash: string,
): { fresh: Annotation[]; stale: StoredAnnotation[] } {
  const fresh: Annotation[] = [];
  const stale: StoredAnnotation[] = [];
  for (const row of rows) {
    if (row.docHash === docHash) {
      const { docHash: _hash, ...annotation } = row;
      fresh.push(annotation);
    } else {
      stale.push(row);
    }
  }
  return { fresh: sortAnnotations(fresh), stale };
}

export function upsertAnnotation(annotations: Annotation[], annotation: Annotation): Annotation[] {
  const rest = annotations.filter((a) => a.id !== annotation.id);
  return sortAnnotations([...rest, annotation]);
}

export function removeAnnotation(annotations: Annotation[], id: string): Annotation[] {
  return annotations.filter((a) => a.id !== id);
}

export function setAnnotationComment(
  annotations: Annotation[],
  id: string,
  comment: string | null,
  now: number,
): Annotation[] {
  return annotations.map((a) => (a.id === id ? { ...a, comment, updatedAt: now } : a));
}

/**
 * One-line form of a quote or a comment, for the annotation sidebar: the line
 * breaks and indentation carried over from the rendered document would
 * otherwise blow a short quote up to the height of the panel.
 */
export function annotationPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Serialize annotations to markdown: each one rendered with the annotation
 * template, in document order, joined with blank lines. Entries the template
 * renders to nothing are left out rather than joined as empty gaps.
 */
export function annotationsToMarkdown(annotations: Annotation[], template: string): string {
  return sortAnnotations(annotations)
    .map((a) => renderAnnotationTemplate(template, { highlight: a.quote, comment: a.comment ?? '' }))
    .filter((entry) => entry.trim() !== '')
    .join('\n\n');
}
