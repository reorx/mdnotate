import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { Annotation } from './annotations';

/**
 * Ordered list numbers, written into the document as text.
 *
 * The browser's own list marker is drawn rather than written: it cannot be
 * selected, copied or found with ⌘F, and the annotator never sees it — a
 * highlight across two items quotes their words with the numbers that told
 * them apart left out. Numbers are often the point ("step 3", "the second
 * option"), so the reader writes them into the rendered document as an
 * ordinary span of text, and the stylesheet hangs it where the marker used to
 * be (see `.list-number` in App.css).
 *
 * Being text, the numbers are now part of what annotation offsets count. That
 * is why the Markdown content hash carries a revision for them, and why
 * annotations made before they were text are moved across once
 * (`remapToListNumbers`) rather than dropped.
 */

export const LIST_NUMBER_CLASS = 'list-number';

function isElement(node: RootContent | ElementContent): node is Element {
  return node.type === 'element';
}

function isBlank(node: ElementContent): boolean {
  return node.type === 'text' && node.value.trim() === '';
}

/**
 * Where an item's number goes: in front of its first line. A loose item's
 * text sits in a paragraph, and a number placed before that paragraph would be
 * a line of its own.
 */
function numberHost(item: Element): Element {
  const first = item.children.find((child) => !isBlank(child));
  return first && isElement(first) && first.tagName === 'p' ? first : item;
}

function numberItems(list: Element): void {
  const start = Number(list.properties.start);
  let n = Number.isInteger(start) ? start : 1;
  for (const item of list.children) {
    if (!isElement(item) || item.tagName !== 'li') continue;
    // The trailing space is part of the text, so a quote or a copy reads
    // "1. First" rather than "1.First"; at the end of the number's own box it
    // takes no room on screen.
    numberHost(item).children.unshift({
      type: 'element',
      tagName: 'span',
      properties: { className: [LIST_NUMBER_CLASS] },
      children: [{ type: 'text', value: `${n}. ` }],
    });
    n += 1;
  }
}

function visit(node: Root | Element): void {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (child.tagName === 'ol') numberItems(child);
    visit(child);
  }
}

/** Rehype plugin: number every ordered list's items, nested lists on their own. */
export function rehypeListNumbers() {
  return (tree: Root) => visit(tree);
}

/** One annotatable text node of the reader, and whether it is a list number. */
export interface TextSegment {
  text: string;
  listNumber: boolean;
}

/**
 * Carry annotations made while list numbers were still drawn by the browser
 * onto the text as it now renders, numbers included.
 *
 * Nothing is searched for: the old text is the new one with the numbers taken
 * out, so every old offset has exactly one new one. An annotation starting
 * where an item starts stays after that item's number, as the user never
 * selected it; one spanning two items takes in the number between them, and
 * its quote is read again to say so. One whose quote is not what its old
 * offsets point at was made on some other text, and is given up on — the same
 * rule as for any annotation the document has changed under.
 */
export function remapToListNumbers(
  annotations: Annotation[],
  segments: TextSegment[],
): { kept: Annotation[]; lost: Annotation[] } {
  let before = '';
  let after = '';
  const numbers: { at: number; length: number }[] = [];
  for (const segment of segments) {
    if (segment.listNumber) numbers.push({ at: before.length, length: segment.text.length });
    else before += segment.text;
    after += segment.text;
  }
  /** How far the numbers written ahead of `offset` push it; `edge` counts one written right at it. */
  const shift = (offset: number, edge: boolean) =>
    numbers.reduce((sum, n) => (n.at < offset || (edge && n.at === offset) ? sum + n.length : sum), 0);

  const kept: Annotation[] = [];
  const lost: Annotation[] = [];
  for (const annotation of annotations) {
    if (before.slice(annotation.start, annotation.end) !== annotation.quote) {
      lost.push(annotation);
      continue;
    }
    const start = annotation.start + shift(annotation.start, true);
    const end = annotation.end + shift(annotation.end, false);
    kept.push({ ...annotation, start, end, quote: after.slice(start, end) });
  }
  return { kept, lost };
}
