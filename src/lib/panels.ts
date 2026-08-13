/**
 * The two side panels of the reader: the table of contents on the left, the
 * annotation list on the right. Their widths are dragged, not sliddered, so the
 * range is in px rather than the rem the typography settings use.
 */

export type PanelSide = 'toc' | 'annotations';

export type PanelWidths = Record<PanelSide, number>;

export const PANEL_WIDTH = { min: 160, max: 480 };

/** The values the stylesheet used to hardcode as w-60 / w-72. */
export const DEFAULT_PANEL_WIDTHS: PanelWidths = { toc: 240, annotations: 288 };

/** The width in range, or null when it is not a number we could put in a style. */
function clampWidth(raw: unknown): number | null {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return null;
  return Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, raw)));
}

/**
 * Read a stored setting back, field by field. Each one falls back on its own,
 * so a single bad value costs only that value.
 */
export function clampPanelWidths(raw: unknown): PanelWidths {
  const stored = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    toc: clampWidth(stored.toc) ?? DEFAULT_PANEL_WIDTHS.toc,
    annotations: clampWidth(stored.annotations) ?? DEFAULT_PANEL_WIDTHS.annotations,
  };
}

/**
 * The width a drag handle at `clientX` asks for: each panel grows from its own
 * window edge, so the toc measures from the left of the reader and the
 * annotation list from the right.
 */
export function panelWidthFromPointer(
  side: PanelSide,
  clientX: number,
  container: { left: number; right: number },
): number {
  const width = side === 'toc' ? clientX - container.left : container.right - clientX;
  return clampWidth(width) ?? PANEL_WIDTH.min;
}
