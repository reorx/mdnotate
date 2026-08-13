export const DEFAULT_TEMPLATE = '# {{filePath}}\n\n{{annotations}}';

/** The shape of a single entry, rendered once per annotation into {{annotations}}. */
export const DEFAULT_ANNOTATION_TEMPLATE = '> {{highlight}}\n{{comment}}';

export interface TemplateContext {
  filePath: string;
  annotations: string;
}

export interface AnnotationTemplateContext {
  highlight: string;
  /** Empty for a pure highlight — see the line-dropping rule below. */
  comment: string;
}

/**
 * Render an export template by substituting {{filePath}} and {{annotations}}.
 * Replacement values are inserted literally (no $-pattern expansion).
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  return template
    .replaceAll('{{filePath}}', () => context.filePath)
    .replaceAll('{{annotations}}', () => context.annotations);
}

const ANNOTATION_PLACEHOLDER = /\{\{(highlight|comment)\}\}/g;

/** Leading indent and blockquote markers, then a list bullet. */
const LINE_PREFIX = /^([ \t>]*)([-*+] +|\d+[.)] +)?/;

/**
 * What a value's own lines have to open with to stay inside the block its
 * first line opened: the quote markers repeated as they are, a bullet blanked
 * out to its own width — a second `- ` would start a second list item.
 */
function continuationPrefix(line: string): string {
  const [, markers = '', bullet = ''] = line.match(LINE_PREFIX) ?? [];
  return markers + ' '.repeat(bullet.length);
}

/**
 * Render one annotation. Two rules let a single template cover both a pure
 * highlight and a commented one, without the template having to say so:
 *
 * - a line whose placeholders all came out empty is dropped whole, so a
 *   highlight without a comment leaves no blank line (nor a stray `**Note:**`)
 *   trailing behind it;
 * - a multi-line value repeats its line's leading markers on every line it
 *   adds, so `> {{highlight}}` quotes all of a quote, not just its first line.
 */
export function renderAnnotationTemplate(template: string, context: AnnotationTemplateContext): string {
  return template
    .split('\n')
    .map((line) => renderAnnotationLine(line, context))
    .filter((line) => line !== null)
    .join('\n');
}

/** null = this line only existed to carry placeholders that turned out empty. */
function renderAnnotationLine(line: string, context: AnnotationTemplateContext): string | null {
  const prefix = continuationPrefix(line);
  let placeholders = 0;
  let filled = 0;
  // A replacer function, so values are inserted literally ($-patterns and all).
  const rendered = line.replace(ANNOTATION_PLACEHOLDER, (_match, key: keyof AnnotationTemplateContext) => {
    placeholders += 1;
    const value = context[key];
    if (value !== '') filled += 1;
    return value.split('\n').join(`\n${prefix}`);
  });
  return placeholders > 0 && filled === 0 ? null : rendered;
}
