import { describe, expect, it } from 'vitest';
import { clampPanelWidths, DEFAULT_PANEL_WIDTHS, PANEL_WIDTH, panelWidthFromPointer } from '../src/lib/panels';

describe('DEFAULT_PANEL_WIDTHS', () => {
  it('keeps the widths the stylesheet used to hardcode (w-60 / w-72)', () => {
    expect(DEFAULT_PANEL_WIDTHS).toEqual({ toc: 240, annotations: 288 });
  });

  it('starts inside its own allowed range', () => {
    for (const width of Object.values(DEFAULT_PANEL_WIDTHS)) {
      expect(width).toBeGreaterThanOrEqual(PANEL_WIDTH.min);
      expect(width).toBeLessThanOrEqual(PANEL_WIDTH.max);
    }
  });
});

describe('clampPanelWidths', () => {
  it('passes valid widths through untouched', () => {
    expect(clampPanelWidths({ toc: 200, annotations: 320 })).toEqual({ toc: 200, annotations: 320 });
  });

  it('pulls out-of-range widths back to the nearest bound', () => {
    expect(clampPanelWidths({ toc: 10, annotations: 9999 })).toEqual({
      toc: PANEL_WIDTH.min,
      annotations: PANEL_WIDTH.max,
    });
  });

  it('rounds fractional widths to whole pixels', () => {
    expect(clampPanelWidths({ toc: 200.6, annotations: 300.4 })).toEqual({ toc: 201, annotations: 300 });
  });

  it('falls back per field, so one bad value does not discard the other', () => {
    expect(clampPanelWidths({ toc: 'wide', annotations: 320 })).toEqual({
      toc: DEFAULT_PANEL_WIDTHS.toc,
      annotations: 320,
    });
  });

  it('rejects NaN and Infinity rather than writing them into a style', () => {
    expect(clampPanelWidths({ toc: NaN, annotations: Infinity })).toEqual({
      toc: DEFAULT_PANEL_WIDTHS.toc,
      annotations: PANEL_WIDTH.max,
    });
  });

  it('falls back entirely for anything that is not an object', () => {
    for (const raw of [null, undefined, 240, '240', []]) {
      expect(clampPanelWidths(raw)).toEqual(DEFAULT_PANEL_WIDTHS);
    }
  });
});

describe('panelWidthFromPointer', () => {
  const container = { left: 100, right: 900 };

  it('measures the toc panel from the container left edge', () => {
    expect(panelWidthFromPointer('toc', 340, container)).toBe(240);
  });

  it('measures the annotations panel from the container right edge', () => {
    expect(panelWidthFromPointer('annotations', 612, container)).toBe(288);
  });

  it('clamps a drag past either bound to the range', () => {
    expect(panelWidthFromPointer('toc', 100, container)).toBe(PANEL_WIDTH.min);
    expect(panelWidthFromPointer('toc', 900, container)).toBe(PANEL_WIDTH.max);
    expect(panelWidthFromPointer('annotations', 900, container)).toBe(PANEL_WIDTH.min);
    expect(panelWidthFromPointer('annotations', 100, container)).toBe(PANEL_WIDTH.max);
  });

  it('rounds to whole pixels', () => {
    expect(panelWidthFromPointer('toc', 340.4, container)).toBe(240);
  });
});
