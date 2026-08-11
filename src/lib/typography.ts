import type { DocFormat } from './doc-locator';

/** A measured column width in rem, or as wide as the window allows. */
export type ContentWidth = number | 'full';

export interface Typography {
  /** Root size of the prose in px. Everything inside scales off it via em. */
  fontSize: number;
  lineHeight: number;
  width: ContentWidth;
}

/**
 * One setting per rendering mode. Markdown prose and a monospace log are read
 * in different ways — the sizes that suit one rarely suit the other.
 */
export type TypographySettings = Record<DocFormat, Typography>;

interface Range {
  min: number;
  max: number;
  step: number;
  /** Digits the step can produce, so a slider never stores 1.7500000000000002. */
  decimals: number;
}

export const FONT_SIZE: Range = { min: 12, max: 24, step: 1, decimals: 0 };
export const LINE_HEIGHT: Range = { min: 1.2, max: 2.2, step: 0.05, decimals: 2 };
export const WIDTH: Range = { min: 32, max: 72, step: 1, decimals: 0 };

/** The values the stylesheet used to hardcode; the only place they are written down. */
export const DEFAULT_TYPOGRAPHY: TypographySettings = {
  markdown: { fontSize: 15, lineHeight: 1.6, width: 46 },
  text: { fontSize: 13, lineHeight: 1.65, width: 46 },
};

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** The value in range, or null when it is not a number we could put in a stylesheet. */
function clampNumber(raw: unknown, range: Range): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return roundTo(Math.min(range.max, Math.max(range.min, raw)), range.decimals);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a stored setting back, field by field. Each one falls back on its own,
 * so a single bad value costs only that value.
 */
export function clampTypography(raw: unknown, fallback: Typography): Typography {
  const stored = isRecord(raw) ? raw : {};
  return {
    fontSize: clampNumber(stored.fontSize, FONT_SIZE) ?? fallback.fontSize,
    lineHeight: clampNumber(stored.lineHeight, LINE_HEIGHT) ?? fallback.lineHeight,
    width: stored.width === 'full' ? 'full' : (clampNumber(stored.width, WIDTH) ?? fallback.width),
  };
}

export function clampTypographySettings(raw: unknown): TypographySettings {
  const stored = isRecord(raw) ? raw : {};
  return {
    markdown: clampTypography(stored.markdown, DEFAULT_TYPOGRAPHY.markdown),
    text: clampTypography(stored.text, DEFAULT_TYPOGRAPHY.text),
  };
}

/**
 * Full width lives on the width slider as one extra step past the last rem
 * value: it is simply what you get by dragging all the way right, rather than
 * a checkbox that makes the slider go dead.
 */
export function widthFromSlider(position: number): ContentWidth {
  if (position >= WIDTH.max + WIDTH.step) return 'full';
  return Math.min(WIDTH.max, Math.max(WIDTH.min, Math.round(position)));
}

export function sliderFromWidth(width: ContentWidth): number {
  return width === 'full' ? WIDTH.max + WIDTH.step : width;
}

export function formatWidth(width: ContentWidth): string {
  return width === 'full' ? 'Full width' : `${width} rem`;
}

/**
 * The custom properties `.prose-dense` / `.prose-plain` / `.prose-column` read.
 * The reader and the settings preview both go through here, so what you see
 * while dragging is what the document gets.
 */
export function typographyVars(typography: Typography): Record<string, string> {
  return {
    '--prose-font-size': `${typography.fontSize}px`,
    '--prose-line-height': String(typography.lineHeight),
    '--prose-width': typography.width === 'full' ? '100%' : `${typography.width}rem`,
  };
}
