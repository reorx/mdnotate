import type { TextAnnotation } from '@recogito/text-annotator';

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
 * Serialize annotations to markdown: each highlight as a blockquote, followed
 * by its comment (if any), joined with blank lines, in document order.
 */
export function annotationsToMarkdown(annotations: Annotation[]): string {
  return sortAnnotations(annotations)
    .map((a) => {
      const quoteBlock = a.quote
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return a.comment ? `${quoteBlock}\n\n${a.comment}` : quoteBlock;
    })
    .join('\n\n');
}
