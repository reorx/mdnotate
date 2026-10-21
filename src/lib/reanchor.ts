import { NOT_ANNOTATABLE_CLASS } from '@recogito/text-annotator';
import { sortAnnotations, type Annotation } from './annotations';

/**
 * Moving annotations onto a document the user has just edited and saved.
 *
 * An annotation is anchored by character offsets into the rendered text, so an
 * edit anywhere before it leaves those offsets pointing at other words — which
 * is why an annotation made on different content is normally given up on (see
 * `splitStaleAnnotations`). An edit made here is different: we still hold the
 * annotations, and each one carries the text it highlights. That quote is
 * enough to find it again in the new text.
 *
 * Only an exact match counts. A quote that no longer appears verbatim was
 * itself edited, and guessing at a near match would paint a highlight over a
 * sentence the user never chose — the very thing the stale rule exists to
 * prevent. Where it appears more than once, the occurrence nearest to where it
 * used to be is the best guess there is: edits move text by small amounts
 * relative to a document's length.
 */
export function reanchorAnnotations(
  annotations: Annotation[],
  text: string,
): { kept: Annotation[]; lost: Annotation[] } {
  const kept: Annotation[] = [];
  const lost: Annotation[] = [];
  for (const annotation of annotations) {
    const start = nearestOccurrence(text, annotation.quote, annotation.start);
    if (start === null) {
      lost.push(annotation);
    } else {
      kept.push({ ...annotation, start, end: start + annotation.quote.length });
    }
  }
  return { kept: sortAnnotations(kept), lost };
}

/** Where `quote` occurs in `text` closest to `near`; null for none — or for an empty quote, which occurs everywhere. */
function nearestOccurrence(text: string, quote: string, near: number): number | null {
  if (quote === '') return null;
  let best: number | null = null;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (best === null || Math.abs(at - near) < Math.abs(best - near)) best = at;
    // Occurrences only move further away once past the old position.
    if (at > near) break;
  }
  return best;
}

/**
 * The text annotation offsets are counted in: every text node under the
 * annotator's container, minus anything inside a `not-annotatable` subtree —
 * the comment markers, the popup, the front matter's label.
 *
 * This has to agree with the annotator library to the character, since the
 * offsets found here are handed straight back to it. It is the same rule the
 * library applies both when it measures a selection and when it revives one.
 */
export function collectAnnotatableText(container: HTMLElement): string {
  const skip = `.${NOT_ANNOTATABLE_CLASS}`;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, (node) =>
    node.parentElement?.closest(skip) ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT,
  );
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) text += node.textContent ?? '';
  return text;
}
