import { describe, expect, it } from 'vitest';
import { placePopup, type PopupAnchor, type PopupBounds, type PopupSize } from '../src/lib/popup-position';

/** A selection two lines tall, sitting comfortably in the middle of the view. */
function anchor(partial: Partial<PopupAnchor> = {}): PopupAnchor {
  return { top: 200, bottom: 240, left: 100, ...partial };
}

/** A 800px-wide container showing the slice from 0 to 600. */
function bounds(partial: Partial<PopupBounds> = {}): PopupBounds {
  return { width: 800, top: 0, bottom: 600, ...partial };
}

function size(partial: Partial<PopupSize> = {}): PopupSize {
  return { width: 300, height: 150, ...partial };
}

describe('placePopup', () => {
  it('hangs the popup under the anchor when there is room', () => {
    expect(placePopup(anchor(), bounds(), size())).toEqual({ top: 246, left: 100 });
  });

  it('flips above the anchor when the popup would not fit below', () => {
    // 6px of gap on the way up too, so the flip does not change the spacing.
    expect(placePopup(anchor({ top: 500, bottom: 540 }), bounds(), size())).toEqual({ top: 344, left: 100 });
  });

  it('stays below when it fits exactly', () => {
    expect(placePopup(anchor({ top: 400, bottom: 444 }), bounds(), size()).top).toBe(450);
  });

  it('flips when it misses fitting below by a single pixel', () => {
    expect(placePopup(anchor({ top: 400, bottom: 445 }), bounds(), size()).top).toBe(244);
  });

  it('measures room against the visible slice, not the top of the document', () => {
    // The container is the whole scrolled document; only part of it is on
    // screen, and that part is what the popup has to fit into.
    const scrolled = bounds({ top: 1000, bottom: 1600 });
    expect(placePopup(anchor({ top: 1500, bottom: 1540 }), scrolled, size()).top).toBe(1344);
  });

  it('covers part of the anchor rather than hang off the view when neither side fits', () => {
    // A tall popup in a short view: 240px below the anchor, 200px above, and
    // 300px of card to place. It ends up flush with the bottom of the view.
    const short = bounds({ bottom: 500 });
    expect(placePopup(anchor({ top: 200, bottom: 260 }), short, size({ height: 300 }))).toEqual({
      top: 200,
      left: 100,
    });
  });

  it('takes the roomier side when neither fits', () => {
    // Same view, anchor lower down: now above is the side with more room, so
    // the card goes flush with the top instead.
    const short = bounds({ bottom: 500 });
    expect(placePopup(anchor({ top: 300, bottom: 360 }), short, size({ height: 300 })).top).toBe(0);
  });

  it('never places the card above the top of the view, however little room there is', () => {
    const tiny = bounds({ top: 0, bottom: 100 });
    expect(placePopup(anchor({ top: 40, bottom: 60 }), tiny, size({ height: 400 })).top).toBe(0);
  });

  it('pulls a popup that would overflow the right edge back inside', () => {
    expect(placePopup(anchor({ left: 700 }), bounds(), size()).left).toBe(500);
  });

  it('leaves the left edge alone when the popup fits', () => {
    expect(placePopup(anchor({ left: 0 }), bounds(), size()).left).toBe(0);
  });

  it('gives up on the right edge rather than going negative in a narrow container', () => {
    expect(placePopup(anchor({ left: 40 }), bounds({ width: 200 }), size()).left).toBe(0);
  });

  it('falls back to hanging below while the popup has not been measured yet', () => {
    // The first render happens before the card can be measured; whatever comes
    // out of it is replaced before the browser paints.
    expect(placePopup(anchor(), bounds(), { width: 0, height: 0 })).toEqual({ top: 246, left: 100 });
  });
});
