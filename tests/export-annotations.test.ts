import { describe, expect, it } from 'vitest';
import type { Annotation } from '../src/lib/annotations';
import { exportUnavailableReason, renderExport } from '../src/lib/export-annotations';
import { DEFAULT_ANNOTATION_TEMPLATE, DEFAULT_TEMPLATE } from '../src/lib/template';

function make(partial: Partial<Annotation> & Pick<Annotation, 'id' | 'start' | 'quote'>): Annotation {
  return {
    end: partial.start + partial.quote.length,
    comment: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const defaults = { template: DEFAULT_TEMPLATE, annotationTemplate: DEFAULT_ANNOTATION_TEMPLATE };

describe('renderExport', () => {
  it('renders the default templates: path heading, then each annotation as a quote and its comment', () => {
    const list = [
      make({ id: 'a', start: 0, quote: 'first', comment: 'a thought' }),
      make({ id: 'b', start: 20, quote: 'second' }),
    ];
    expect(renderExport('/notes/doc.md', list, defaults)).toBe('# /notes/doc.md\n\n> first\na thought\n\n> second');
  });

  it('puts annotations in document order whatever order they come in', () => {
    const list = [make({ id: 'b', start: 20, quote: 'second' }), make({ id: 'a', start: 0, quote: 'first' })];
    expect(renderExport('doc.md', list, defaults)).toBe('# doc.md\n\n> first\n\n> second');
  });

  it('follows custom outer and per-annotation templates from settings', () => {
    const list = [make({ id: 'a', start: 0, quote: 'q', comment: 'c' })];
    const out = renderExport('doc.md', list, {
      template: 'From {{filePath}}:\n{{annotations}}',
      annotationTemplate: '- {{highlight}}\n  **Note:** {{comment}}',
    });
    expect(out).toBe('From doc.md:\n- q\n  **Note:** c');
  });
});

describe('exportUnavailableReason', () => {
  it('allows exporting once there is an annotation and the document is being read', () => {
    expect(exportUnavailableReason({ count: 1, editing: false })).toBeNull();
  });

  it('asks for a highlight first when there is nothing to export', () => {
    expect(exportUnavailableReason({ count: 0, editing: false })).toBe('Highlight some text first');
  });

  it('waits for View while editing, since saving may still move the annotations', () => {
    expect(exportUnavailableReason({ count: 3, editing: true })).toBe('Switch to View to export');
    expect(exportUnavailableReason({ count: 0, editing: true })).toBe('Switch to View to export');
  });
});
