import { annotationsToMarkdown, type Annotation } from './annotations';
import { renderTemplate } from './template';

/** The two template settings an export is rendered through. */
export interface ExportTemplates {
  /** Outer: `{{filePath}}` and `{{annotations}}`. */
  template: string;
  /** Per entry: `{{highlight}}` and `{{comment}}`. */
  annotationTemplate: string;
}

/**
 * The text an export of these annotations comes out as. One function for both
 * ways of exporting — the header's one-click copy and the Export page — so what
 * is copied without looking is exactly what the page would have shown.
 */
export function renderExport(filePath: string, annotations: Annotation[], templates: ExportTemplates): string {
  return renderTemplate(templates.template, {
    filePath,
    annotations: annotationsToMarkdown(annotations, templates.annotationTemplate),
  });
}

/**
 * Why neither export entry can be used right now, or null when both can.
 * Editing comes first: the annotations are about the saved text and may yet
 * move when it is saved again, so even an existing set is not final.
 */
export function exportUnavailableReason({ count, editing }: { count: number; editing: boolean }): string | null {
  if (editing) return 'Switch to View to export';
  if (count === 0) return 'Highlight some text first';
  return null;
}

