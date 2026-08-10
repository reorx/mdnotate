import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE, renderTemplate } from '../src/lib/template';

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
