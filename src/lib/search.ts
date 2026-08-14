/**
 * Finding text in the rendered document.
 *
 * The search does not run over the document's text as the DOM holds it, but
 * over a normalized copy: every run of whitespace folds down to a single space,
 * and a newline is written wherever one block ends and the next begins. Those
 * two rules are what make the search behave the way a browser's does —
 * `quick brown` is found even though the markdown source broke the line between
 * the two words, and the last word of one paragraph never runs into the first
 * word of the next (in the DOM there is not so much as a space between them).
 *
 * Every normalized character remembers the raw span it stands for, so a match
 * comes back out as offsets into the original text — which is what the caller
 * turns into a DOM Range. Nothing here touches the DOM; that half lives in
 * `use-doc-search.ts`.
 */

/** One text node's worth of the document, in document order. */
export interface TextSegment {
  /** The node's text, exactly as the DOM holds it. */
  text: string;
  /** Whether a block boundary sits between this segment and the one before it. */
  blockStart: boolean;
}

export interface SearchIndex {
  /** The normalized, searchable text. */
  text: string;
  /** `text` case-folded — same length, character for character. */
  lower: string;
  /** Where normalized character i begins in the concatenated segment text. */
  starts: number[];
  /** Where it ends. Separate from `starts` because a folded space stands for a
   *  whole run of whitespace, and a block boundary stands for nothing at all. */
  ends: number[];
}

/** A match, as offsets into the concatenated segment text. */
export interface SearchMatch {
  start: number;
  end: number;
}

/**
 * How many matches are worth having. Searching `a` in an eight-megabyte log
 * would otherwise mean a few hundred thousand DOM ranges, which is neither
 * useful to read nor cheap to build; the count is shown as `5000+` instead.
 */
export const MAX_MATCHES = 5000;

const WHITESPACE = /\s/;

/**
 * Lowercase without moving anything.
 *
 * `'İ'.toLowerCase()` is two code units, and one such character anywhere in the
 * document would shift every offset after it — highlighting a sentence the user
 * never searched for. Any character that will not lowercase in place is left
 * as it is, which at worst costs a match on a letter almost nobody searches by.
 */
export function foldCase(text: string): string {
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

export function buildSearchIndex(segments: TextSegment[]): SearchIndex {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let raw = 0;
  // Where the run of whitespace we are inside began; null when we are not.
  // Held across segments, since inline markup breaks a single space in two.
  let pending: number | null = null;

  const emit = (ch: string, start: number, end: number) => {
    chars.push(ch);
    starts.push(start);
    ends.push(end);
  };
  const last = () => chars[chars.length - 1];

  for (const segment of segments) {
    if (segment.blockStart) {
      // The boundary swallows the whitespace on either side of it: a paragraph
      // that ends in a space is still the end of a paragraph.
      pending = null;
      if (chars.length > 0 && last() !== '\n') emit('\n', raw, raw);
    }
    // By code unit rather than by code point, so one character is one entry and
    // the offsets stay aligned with what `indexOf` will report.
    for (let i = 0; i < segment.text.length; i++) {
      const ch = segment.text[i];
      if (WHITESPACE.test(ch)) {
        if (pending === null) pending = raw;
      } else {
        if (pending !== null) {
          // Nothing to separate at the very start, or right after a boundary.
          if (chars.length > 0 && last() !== '\n') emit(' ', pending, raw);
          pending = null;
        }
        emit(ch, raw, raw + 1);
      }
      raw++;
    }
  }

  const text = chars.join('');
  return { text, lower: foldCase(text), starts, ends };
}

/** Fold the query the way the document was folded, so the two can meet. Not
 *  trimmed: a leading space is part of what the user asked to find. */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ');
}

export function findMatches(index: SearchIndex, query: string, limit = MAX_MATCHES): SearchMatch[] {
  const needle = foldCase(normalizeQuery(query));
  if (!needle) return [];

  const matches: SearchMatch[] = [];
  let from = 0;
  while (matches.length < limit) {
    const at = index.lower.indexOf(needle, from);
    if (at === -1) break;
    matches.push({ start: index.starts[at], end: index.ends[at + needle.length - 1] });
    // Non-overlapping, as every find bar counts them.
    from = at + needle.length;
  }
  return matches;
}

/** The next match in the given direction, wrapping at either end. -1 in, -1
 *  out when there is nothing to step through; -1 in otherwise means "start at
 *  whichever end we are walking from". */
export function stepMatch(count: number, current: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}

/** What the find bar puts next to the input. */
export function matchLabel(count: number, active: number, capped: boolean): string {
  if (count === 0) return '0/0';
  return `${active + 1}/${count}${capped ? '+' : ''}`;
}
