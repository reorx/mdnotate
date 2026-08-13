import type { Annotation } from './annotations';

/**
 * Where the comment icons go.
 *
 * The annotator paints a highlight as one rectangle per visual line. The icon
 * belongs at the end of the highlight, which is the far edge of its last line —
 * so the geometry is a small rule over those rectangles, and lives here where
 * it can be tested without a browser.
 */

/** One painted rectangle, in coordinates relative to the reader container. */
export interface MarkerRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CommentMarker {
  id: string;
  /** The right edge of the highlight's last line: where the icon starts. */
  left: number;
  /** The vertical middle of that line. */
  top: number;
}

/** Positions jitter in the last decimals as the page scrolls; a tenth of a
 *  pixel is already finer than anything an icon can be drawn at. */
const round = (value: number) => Math.round(value * 10) / 10;

export function commentMarkers(annotations: Annotation[], rects: Map<string, MarkerRect[]>): CommentMarker[] {
  const markers: CommentMarker[] = [];
  for (const annotation of annotations) {
    if (!annotation.comment) continue;
    const end = lastLine(rects.get(annotation.id));
    // No rectangle means the annotator has not painted this one (yet).
    if (!end) continue;
    markers.push({
      id: annotation.id,
      left: round(end.left + end.width),
      top: round(end.top + end.height / 2),
    });
  }
  return markers;
}

/**
 * The rectangle the icon hangs off: the lowest line, and the rightmost
 * rectangle on it. Found by position rather than by taking the last of the
 * list, because the renderer merges and reorders what it paints — and a line
 * broken up by inline code yields rectangles of differing heights, so "the same
 * line" is "its middle is below the top of the lowest one" rather than an equal
 * `top`.
 */
function lastLine(rects: MarkerRect[] | undefined): MarkerRect | null {
  if (!rects || rects.length === 0) return null;
  const lowest = rects.reduce((a, b) => (b.top > a.top ? b : a));
  return rects
    .filter((r) => r.top + r.height / 2 > lowest.top)
    .reduce((a, b) => (b.left + b.width > a.left + a.width ? b : a));
}

/** Whether two marker sets would draw the same thing. */
export function sameMarkers(a: CommentMarker[], b: CommentMarker[]): boolean {
  return a.length === b.length && a.every((m, i) => m.id === b[i].id && m.left === b[i].left && m.top === b[i].top);
}
