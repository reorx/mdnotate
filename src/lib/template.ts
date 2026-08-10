export const DEFAULT_TEMPLATE = '# {{filePath}}\n\n{{annotations}}';

export interface TemplateContext {
  filePath: string;
  annotations: string;
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
