import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANNOTATION_TEMPLATE,
  DEFAULT_TEMPLATE,
  renderAnnotationTemplate,
  renderTemplate,
} from '../src/lib/template';

describe('renderTemplate', () => {
  it('replaces {{filePath}} and {{annotations}} placeholders', () => {
    const out = renderTemplate('# {{filePath}}\n\n{{annotations}}', {
      filePath: '/docs/note.md',
      annotations: '> q\n\nc',
    });
    expect(out).toBe('# /docs/note.md\n\n> q\n\nc');
  });

  it('replaces repeated occurrences of the same placeholder', () => {
    const out = renderTemplate('{{filePath}} {{filePath}}', {
      filePath: 'a.md',
      annotations: '',
    });
    expect(out).toBe('a.md a.md');
  });

  it('leaves unknown placeholders untouched', () => {
    const out = renderTemplate('{{unknown}}', { filePath: 'a.md', annotations: '' });
    expect(out).toBe('{{unknown}}');
  });

  it('default template puts "# <filePath>" on the first line and annotations after a blank line', () => {
    const out = renderTemplate(DEFAULT_TEMPLATE, {
      filePath: '/Users/me/doc.md',
      annotations: '> highlight\n\ncomment',
    });
    expect(out.split('\n')[0]).toBe('# /Users/me/doc.md');
    expect(out).toBe('# /Users/me/doc.md\n\n> highlight\n\ncomment');
  });
});

describe('renderAnnotationTemplate', () => {
  it('replaces {{highlight}} and {{comment}} placeholders', () => {
    const out = renderAnnotationTemplate('> {{highlight}}\n{{comment}}', {
      highlight: 'some quoted text',
      comment: 'my thought',
    });
    expect(out).toBe('> some quoted text\nmy thought');
  });

  // A highlight spans whatever the user dragged over, newlines included, and
  // the markers that opened the block have to keep holding it.
  it('carries the line prefix onto every line of a multi-line value', () => {
    const out = renderAnnotationTemplate('> {{highlight}}', {
      highlight: 'line one\nline two',
      comment: '',
    });
    expect(out).toBe('> line one\n> line two');
  });

  // A repeated bullet would open a second list item, so it is blanked out to
  // its own width and the value lines up under the first one.
  it('blanks out a list bullet on the lines a value adds', () => {
    expect(renderAnnotationTemplate('- {{highlight}}', { highlight: 'one\ntwo', comment: '' })).toBe('- one\n  two');
    expect(renderAnnotationTemplate('  1. {{highlight}}', { highlight: 'one\ntwo', comment: '' })).toBe(
      '  1. one\n     two',
    );
    expect(renderAnnotationTemplate('> - {{highlight}}', { highlight: 'one\ntwo', comment: '' })).toBe(
      '> - one\n>   two',
    );
  });

  // One template has to cover both kinds of annotation, so the comment line
  // must disappear rather than leave a blank one behind.
  it('drops a line whose placeholders all came out empty', () => {
    const out = renderAnnotationTemplate('> {{highlight}}\n{{comment}}', {
      highlight: 'just highlighted',
      comment: '',
    });
    expect(out).toBe('> just highlighted');
  });

  it('drops the surrounding literal text of an empty placeholder along with its line', () => {
    const out = renderAnnotationTemplate('> {{highlight}}\n**Note:** {{comment}}', {
      highlight: 'q',
      comment: '',
    });
    expect(out).toBe('> q');
  });

  it('keeps a line where at least one placeholder has a value', () => {
    const out = renderAnnotationTemplate('{{highlight}} — {{comment}}', { highlight: 'q', comment: '' });
    expect(out).toBe('q — ');
  });

  it('keeps lines that hold no placeholder at all', () => {
    const out = renderAnnotationTemplate('---\n> {{highlight}}', { highlight: 'q', comment: '' });
    expect(out).toBe('---\n> q');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(renderAnnotationTemplate('{{author}}', { highlight: 'q', comment: '' })).toBe('{{author}}');
  });

  it('default template quotes the highlight and puts the comment on the next line', () => {
    expect(renderAnnotationTemplate(DEFAULT_ANNOTATION_TEMPLATE, { highlight: 'q', comment: 'c' })).toBe('> q\nc');
    expect(renderAnnotationTemplate(DEFAULT_ANNOTATION_TEMPLATE, { highlight: 'q', comment: '' })).toBe('> q');
  });
});
