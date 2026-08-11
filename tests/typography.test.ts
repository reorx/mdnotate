import { describe, expect, it } from 'vitest';
import {
  clampTypography,
  DEFAULT_TYPOGRAPHY,
  formatWidth,
  sliderFromWidth,
  typographyVars,
  WIDTH,
  widthFromSlider,
  type Typography,
} from '../src/lib/typography';

const markdown = DEFAULT_TYPOGRAPHY.markdown;

describe('DEFAULT_TYPOGRAPHY', () => {
  it('keeps the dense reading values the stylesheet used to hardcode', () => {
    expect(markdown).toEqual({ fontSize: 15, lineHeight: 1.6, width: 46 });
  });

  it('starts plain text smaller, as the monospace view always was', () => {
    expect(DEFAULT_TYPOGRAPHY.text).toEqual({ fontSize: 13, lineHeight: 1.65, width: 46 });
  });
});

describe('clampTypography', () => {
  it('passes a valid setting through untouched', () => {
    const value: Typography = { fontSize: 18, lineHeight: 1.85, width: 60 };
    expect(clampTypography(value, markdown)).toEqual(value);
  });

  it('pulls out-of-range numbers back to the nearest bound', () => {
    expect(clampTypography({ fontSize: 99, lineHeight: 0.2, width: 999 }, markdown)).toEqual({
      fontSize: 24,
      lineHeight: 1.2,
      width: 72,
    });
  });

  it('rounds to the precision the sliders can produce', () => {
    expect(clampTypography({ fontSize: 15.7, lineHeight: 1.7500000000000002, width: 46.4 }, markdown)).toEqual({
      fontSize: 16,
      lineHeight: 1.75,
      width: 46,
    });
  });

  it('keeps "full" width, and rejects any other string', () => {
    expect(clampTypography({ ...markdown, width: 'full' }, markdown).width).toBe('full');
    expect(clampTypography({ ...markdown, width: 'wide' }, markdown).width).toBe(markdown.width);
  });

  it('falls back per field, so one bad value does not discard the rest', () => {
    expect(clampTypography({ fontSize: 20, lineHeight: 'tall' }, markdown)).toEqual({
      fontSize: 20,
      lineHeight: markdown.lineHeight,
      width: markdown.width,
    });
  });

  it('rejects NaN and Infinity rather than writing them into a stylesheet', () => {
    expect(clampTypography({ fontSize: NaN, lineHeight: Infinity, width: -Infinity }, markdown)).toEqual(markdown);
  });

  it('falls back entirely for anything that is not an object', () => {
    for (const raw of [null, undefined, '15px', 15, []]) {
      expect(clampTypography(raw, markdown)).toEqual(markdown);
    }
  });
});

describe('widthFromSlider / sliderFromWidth', () => {
  it('treats the position past the last rem step as full width', () => {
    expect(widthFromSlider(WIDTH.max + 1)).toBe('full');
    expect(sliderFromWidth('full')).toBe(WIDTH.max + 1);
  });

  it('roundtrips every rem value on the track', () => {
    for (let rem = WIDTH.min; rem <= WIDTH.max; rem += WIDTH.step) {
      expect(widthFromSlider(sliderFromWidth(rem))).toBe(rem);
    }
  });

  it('clamps positions that fall outside the track', () => {
    expect(widthFromSlider(0)).toBe(WIDTH.min);
    expect(widthFromSlider(9999)).toBe('full');
  });
});

describe('formatWidth', () => {
  it('labels rem widths with their unit and full width in words', () => {
    expect(formatWidth(46)).toBe('46 rem');
    expect(formatWidth('full')).toBe('Full width');
  });
});

describe('typographyVars', () => {
  it('maps a setting onto the custom properties the stylesheet reads', () => {
    expect(typographyVars(markdown)).toEqual({
      '--prose-font-size': '15px',
      '--prose-line-height': '1.6',
      '--prose-width': '46rem',
    });
  });

  it('renders full width as the whole available column', () => {
    expect(typographyVars({ ...markdown, width: 'full' })['--prose-width']).toBe('100%');
  });
});
