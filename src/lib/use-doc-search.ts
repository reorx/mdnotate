import { useEffect, useRef, useState, type RefObject } from 'react';
import { isCancelEscape } from './keys';
import {
  buildSearchIndex,
  findMatches,
  MAX_MATCHES,
  normalizeQuery,
  stepMatch,
  type SearchIndex,
  type SearchMatch,
  type TextSegment,
} from './search';
import { NOT_ANNOTATABLE_CLASS } from './use-text-annotator';

/**
 * The DOM half of find-in-document: walk the rendered text into segments, hand
 * them to `search.ts` for the matching, and turn what comes back into ranges
 * the browser can paint.
 *
 * Nothing here writes to the document. The matches are painted through the CSS
 * Custom Highlight API, which colours text without an element of its own — so
 * the prose the annotator measures its character offsets against is left
 * exactly as react-markdown rendered it, and scrolling, resizing and changing
 * the type size need no bookkeeping at all.
 */

const HIGHLIGHT_ALL = 'mdnotate-find';
const HIGHLIGHT_ACTIVE = 'mdnotate-find-active';

/** WebKit has had this since Safari 17.2 (macOS 14.2). Older systems keep the
 *  counter and the jumps and go without the colour, rather than the feature. */
const PAINTS = typeof CSS !== 'undefined' && 'highlights' in CSS;

/** Where a match is put when it has to be scrolled to: a third of the way down,
 *  which leaves the sentence it belongs to visible above it. */
const REVEAL_AT = 0.3;
const REVEAL_MARGIN = 8;

/** Longer than this and a selection is a paragraph, not a search term. */
const MAX_PREFILL = 100;

/**
 * What counts as a block for the purpose of "these two words are not next to
 * each other". Everything the reader can render — react-markdown's output, the
 * wrapper we put around wide tables — is in here; anything else is treated as
 * inline, which is the safe way round (a missed boundary costs one improbable
 * false match, an invented one loses a real phrase).
 */
const BLOCK_TAGS = new Set([
  'ARTICLE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'LI',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TD',
  'TH',
  'TR',
  'UL',
]);

interface DomSegment extends TextSegment {
  node: Text;
  /** Where this segment begins in the concatenation of all of them. */
  start: number;
}

function blockOf(node: Text, container: HTMLElement): Element | null {
  let el = node.parentElement;
  while (el && el !== container && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement;
  return el;
}

/**
 * The document's text nodes in order, skipping the ones the annotator skips —
 * our own comment icons and popup live inside the same container, and their
 * text is no part of the document.
 */
function collectSegments(container: HTMLElement): DomSegment[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(`.${NOT_ANNOTATABLE_CLASS}`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });

  const segments: DomSegment[] = [];
  let start = 0;
  let previous: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const block = blockOf(text, container);
    segments.push({
      node: text,
      text: text.data,
      start,
      blockStart: previous !== null && block !== previous,
    });
    start += text.data.length;
    previous = block;
  }
  return segments;
}

/** The segment a character offset falls in, by binary search over their starts. */
function locate(segments: DomSegment[], offset: number): { node: Text; offset: number } {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].start <= offset) lo = mid;
    else hi = mid - 1;
  }
  const segment = segments[lo];
  return { node: segment.node, offset: Math.min(offset - segment.start, segment.text.length) };
}

function rangeFor(segments: DomSegment[], match: SearchMatch): Range | null {
  if (segments.length === 0) return null;
  const from = locate(segments, match.start);
  const to = locate(segments, match.end);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/**
 * The first match at or below the top of the viewport — where a find starts
 * from, rather than at the top of the document. Matches come in document order,
 * so their tops only ever increase and a binary search will do; each probe
 * costs a layout read, and a long document can have thousands of them.
 */
function firstVisible(ranges: Range[], top: number): number {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid].getBoundingClientRect().top < top) lo = mid + 1;
    else hi = mid;
  }
  // Everything is behind us: come round to the top, as the ∧ ∨ buttons do.
  return lo < ranges.length ? lo : 0;
}

/** What the user had selected when they reached for ⌘F, if it is worth finding. */
function selectionQuery(container: HTMLElement): string | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  if (!container.contains(selection.getRangeAt(0).commonAncestorContainer)) return null;
  const text = normalizeQuery(selection.toString()).trim();
  return text && text.length <= MAX_PREFILL ? text : null;
}

interface SearchResult {
  count: number;
  /** 0-based; -1 when there is nothing to point at. */
  active: number;
  /** Whether the count stopped at MAX_MATCHES rather than at the last match. */
  capped: boolean;
}

const NO_RESULT: SearchResult = { count: 0, active: -1, capped: false };

export interface UseDocSearchOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  /** The element the document scrolls in — what a match is revealed within. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * A key that changes whenever the rendered text is replaced — another
   * document, the same one re-read, or the same one shown as source instead of
   * as Markdown. A new one drops the index and the search along with it.
   *
   * The index holds real DOM text nodes, so it does not survive a re-render
   * that builds different ones: keying it on the content alone would leave a
   * view switch searching nodes that are no longer in the document.
   */
  revision: string;
  /** Off while the reader has no document, or is covered by another view. */
  enabled: boolean;
  /** Called when the bar takes the document's selection for its query, so the
   *  annotation draft that selection started can be given up. */
  onTakeSelection: () => void;
}

export function useDocSearch({ containerRef, scrollRef, revision, enabled, onTakeSelection }: UseDocSearchOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [result, setResult] = useState<SearchResult>(NO_RESULT);
  // Bumped by every ⌘F, so pressing it again with the bar already open focuses
  // the box and selects what is in it rather than doing nothing.
  const [focusToken, setFocusToken] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const segmentsRef = useRef<DomSegment[]>([]);
  // Built on the first search of a document, not on opening it: walking eight
  // megabytes of log is not something a reader who never searches should pay.
  const indexRef = useRef<SearchIndex | null>(null);
  const rangesRef = useRef<Range[]>([]);
  // Mirrors of state the key handler and the steppers read synchronously.
  const activeRef = useRef(-1);
  const openRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const onTakeSelectionRef = useRef(onTakeSelection);
  onTakeSelectionRef.current = onTakeSelection;

  const applyResult = (next: SearchResult) => {
    activeRef.current = next.active;
    setResult(next);
  };

  const paint = () => {
    if (!PAINTS) return;
    const ranges = rangesRef.current;
    const active = activeRef.current;
    // The current match is left out of the other highlight rather than layered
    // over it: one range, one colour, and no reliance on how a browser resolves
    // two highlights covering the same text.
    CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...ranges.filter((_, i) => i !== active)));
    const current = ranges[active];
    if (current) CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(current));
    else CSS.highlights.delete(HIGHLIGHT_ACTIVE);
  };

  const unpaint = () => {
    if (!PAINTS) return;
    CSS.highlights.delete(HIGHLIGHT_ALL);
    CSS.highlights.delete(HIGHLIGHT_ACTIVE);
  };

  const reveal = (range: Range) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const view = scroller.getBoundingClientRect();
    // Already in sight: leave the page where the reader put it.
    if (rect.top >= view.top + REVEAL_MARGIN && rect.bottom <= view.bottom - REVEAL_MARGIN) return;
    scroller.scrollTop += rect.top - view.top - view.height * REVEAL_AT;
  };

  const search = (text: string) => {
    const container = containerRef.current;
    if (!container) return;
    if (!indexRef.current) {
      segmentsRef.current = collectSegments(container);
      indexRef.current = buildSearchIndex(segmentsRef.current);
    }
    // One past the cap, so `5000+` is only ever shown when there really is a
    // 5001st match rather than whenever the count lands exactly on the cap.
    const found = findMatches(indexRef.current, text, MAX_MATCHES + 1);
    const capped = found.length > MAX_MATCHES;
    const ranges = (capped ? found.slice(0, MAX_MATCHES) : found)
      .map((match) => rangeFor(segmentsRef.current, match))
      .filter((range): range is Range => range !== null);
    rangesRef.current = ranges;

    const viewTop = scrollRef.current?.getBoundingClientRect().top ?? 0;
    const active = ranges.length > 0 ? firstVisible(ranges, viewTop) : -1;
    applyResult({ count: ranges.length, active, capped });
    paint();
    if (ranges[active]) reveal(ranges[active]);
  };

  const step = (delta: number) => {
    const ranges = rangesRef.current;
    if (ranges.length === 0) return;
    const next = stepMatch(ranges.length, activeRef.current, delta);
    activeRef.current = next;
    setResult((current) => ({ ...current, active: next }));
    paint();
    reveal(ranges[next]);
  };

  const openBar = () => {
    const container = containerRef.current;
    const selected = container ? selectionQuery(container) : null;
    if (selected !== null) {
      // Selecting text is also how an annotation gets started. Taking that
      // selection for the search means giving the draft up — but only then; a
      // ⌘F with nothing selected must not throw away a comment being written.
      onTakeSelectionRef.current();
      setQuery(selected);
    }
    openRef.current = true;
    setOpen(true);
    setFocusToken((token) => token + 1);
  };

  const close = () => {
    openRef.current = false;
    setOpen(false);
    rangesRef.current = [];
    applyResult(NO_RESULT);
    // Not left to the effect cleanup below. That one only runs once React has
    // re-rendered with the bar closed, which is a frame too late when what is
    // underneath the highlights has just been replaced by another document.
    unpaint();
  };

  // Different text on screen is a different index, and no reason to go on
  // hunting for the last one's word.
  useEffect(() => {
    indexRef.current = null;
    segmentsRef.current = [];
    if (!openRef.current) return;
    setQuery('');
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // Where the highlights are painted. `revision` is deliberately NOT a
  // dependency, and taking it out is not an optimisation.
  //
  // The effect above closes the bar for a new document, but a `setState` only
  // lands on the next render — so an effect that also woke on `revision` would
  // run first, in the very same commit, still holding the old `open` and the
  // old `query`, and would search the *new* document for the *old* word. That
  // costs more than a wasted pass: `search` reveals what it finds, and the
  // render that finally closes the bar takes the highlights down without
  // putting the scroll position back. Reopening an edited document with the
  // find bar still up would land you at a stale match instead of at the top.
  //
  // Without `revision` in the list, this effect simply does not run in that
  // commit; it wakes on the next render, sees the bar closed, and stops.
  useEffect(() => {
    if (!open || composing) return;
    search(query);
    return unpaint;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, composing]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, focusToken]);

  // Every closure below reads its moving parts out of a ref, so the listener is
  // registered once and never has to be swapped.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      // The annotation popup's box has its own idea of what these keys mean,
      // and the comment being typed in it is not ours to throw away. It does
      // not cover the find box, which is an input and where Escape closing the
      // bar is the whole point — except while an input method is composing in
      // it, which is what `isCancelEscape` below is for.
      const inTextBox = event.target instanceof HTMLTextAreaElement;
      if (mod && key === 'f' && !inTextBox) {
        event.preventDefault();
        openBar();
      } else if (mod && key === 'g') {
        event.preventDefault();
        if (openRef.current) step(event.shiftKey ? -1 : 1);
      } else if (isCancelEscape(event) && openRef.current && !inTextBox) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    open,
    query,
    count: result.count,
    active: result.active,
    capped: result.capped,
    /** False on a system too old to paint highlights; everything else works. */
    paints: PAINTS,
    inputRef,
    setQuery,
    setComposing,
    step,
    close,
  };
}
