/**
 * How find-in-document's matches are put on screen — and, more to the point,
 * taken off again.
 *
 * The colour comes from the CSS Custom Highlight API: two named highlights,
 * one for every match and one for the current match, styled in
 * `find-highlight.css`. The obvious way to drive that registry — build a fresh
 * `Highlight` for each search and `CSS.highlights.set()` it, `delete()` it
 * when the bar closes — does not work on the WebKit that ships with macOS.
 * `delete()`, and `set()` under a name that is already taken, repaint nothing:
 * the ranges that just stopped being highlighted keep their colour until
 * something else redraws that text. Clearing the query or closing the bar
 * would leave the page covered in stale blue (reproduced on macOS 26 with
 * `tmp/2026-09-17-find-highlight-repaint/repro.html`; WebKit fixed it in
 * 319154@main, 2026-08, which had not reached a release when this was
 * written).
 *
 * What does repaint is mutating a registered `Highlight` itself: its `add`,
 * `delete` and `clear` invalidate exactly the ranges they touch. So the two
 * objects are registered once, here, and every later paint empties and refills
 * them in place. Nothing else may touch the registry under these names.
 *
 * The browser types are kept out so the rule can be tested against fakes.
 */

export const FIND_HIGHLIGHT_ALL = 'mdnotate-find';
export const FIND_HIGHLIGHT_ACTIVE = 'mdnotate-find-active';

/** The part of `Highlight` this needs. */
export interface HighlightLike<R> {
  add(range: R): unknown;
  clear(): void;
}

/** The part of `CSS.highlights` this needs. */
export interface HighlightRegistryLike<R> {
  set(name: string, highlight: HighlightLike<R>): unknown;
}

export interface FindPainter<R> {
  /** Show these matches, with `active` (an index, or -1 for none) picked out. */
  paint(ranges: R[], active: number): void;
  /** Show nothing. */
  clear(): void;
}

export function createFindPainter<R>(
  registry: HighlightRegistryLike<R>,
  createHighlight: () => HighlightLike<R>,
): FindPainter<R> {
  const all = createHighlight();
  const current = createHighlight();
  registry.set(FIND_HIGHLIGHT_ALL, all);
  registry.set(FIND_HIGHLIGHT_ACTIVE, current);

  const clear = () => {
    all.clear();
    current.clear();
  };

  return {
    paint(ranges, active) {
      clear();
      // The current match goes in one highlight or the other, never both: one
      // range, one colour, and no reliance on how a browser resolves two
      // highlights covering the same text.
      ranges.forEach((range, i) => {
        if (i === active) current.add(range);
        else all.add(range);
      });
    },
    clear,
  };
}
