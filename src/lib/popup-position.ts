/**
 * Where the annotation popup goes.
 *
 * It hangs under what it belongs to — the selection being annotated, or the
 * highlight that was clicked — and moves out of the way when that would put it
 * off screen. Which is a small rule over four rectangles, so it lives here
 * where it can be tested without a browser.
 *
 * Everything is in coordinates relative to the reader container, the same frame
 * the popup is positioned in and the same one `annotation-markers` works in.
 */

/** The rectangle the popup hangs off. */
export interface PopupAnchor {
  top: number;
  bottom: number;
  left: number;
}

/** The room the popup has: the container's width, and the slice of it on screen. */
export interface PopupBounds {
  width: number;
  top: number;
  bottom: number;
}

/** The card's own size — measured, not declared: it is as wide as its contents. */
export interface PopupSize {
  width: number;
  height: number;
}

export interface PopupPlacement {
  top: number;
  left: number;
}

/** Between the anchor and the card, on whichever side the card ends up. */
const GAP = 6;

export function placePopup(anchor: PopupAnchor, bounds: PopupBounds, size: PopupSize): PopupPlacement {
  return {
    top: placeTop(anchor, bounds, size.height),
    left: clamp(anchor.left, 0, Math.max(0, bounds.width - size.width)),
  };
}

function placeTop(anchor: PopupAnchor, bounds: PopupBounds, height: number): number {
  const below = anchor.bottom + GAP;
  if (below + height <= bounds.bottom) return below;
  const above = anchor.top - GAP - height;
  if (above >= bounds.top) return above;
  // Neither side has room. Cover a little of the anchor on the roomier side
  // rather than let the card hang off the edge: the text under it is still
  // there to read once the popup is gone, half a popup is no use to anyone.
  const roomier = anchor.top - bounds.top > bounds.bottom - anchor.bottom ? above : below;
  return clamp(roomier, bounds.top, Math.max(bounds.top, bounds.bottom - height));
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
