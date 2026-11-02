import { describe, expect, it } from 'vitest';
import { annotationsToMarkdown, type Annotation } from '../src/lib/annotations';
import { DEFAULT_ANNOTATION_TEMPLATE, DEFAULT_TEMPLATE, renderTemplate } from '../src/lib/template';
import { previewAnnotationImport } from '../src/lib/import-annotations';

const annotation = (quote: string, comment: string | null = null, start = 0): Annotation => ({
  id: crypto.randomUUID(), quote, comment, start, end: start + quote.length, createdAt: 1, updatedAt: 1,
});
const exported = (items: Annotation[]) => renderTemplate(DEFAULT_TEMPLATE, {
  filePath: '/another/document.md', annotations: annotationsToMarkdown(items, DEFAULT_ANNOTATION_TEMPLATE),
});
const preview = (input: string, text: string, existing: Annotation[] = []) =>
  previewAnnotationImport(input, text, existing);

describe('default Markdown annotation import', () => {
  it('round trips highlights and comments without interpreting literal Markdown or whitespace', () => {
    const items = [annotation(' 中文😀 $& **literal**  ', null), annotation('line one\n\n> nested\nlast ', 'first\nsecond\n\nnew paragraph', 30)];
    const text = items.map(a => a.quote).join('|');
    const rows = preview(exported(items), text);
    expect(rows.map(({ quote, comment, status }) => ({ quote, comment, status }))).toEqual(
      items.map(({ quote, comment }) => ({ quote, comment, status: 'ready' })),
    );
    for (const row of rows) expect(text.slice(row.start!, row.end!)).toBe(row.quote);
  });
  it.each(['\r\n', '\r'])('normalizes %j line endings only', (eol) => {
    const input = exported([annotation('a\nb', ' c\nd ')]).replaceAll('\n', eol);
    expect(preview(input, 'a\nb')[0]).toMatchObject({ quote: 'a\nb', comment: ' c\nd ', status: 'ready' });
  });
  it('accepts entries without a path heading and never uses the heading for routing', () => {
    expect(preview('> hello\n# comment heading', 'hello')[0]).toMatchObject({ status: 'ready', comment: '# comment heading' });
    expect(preview('# /wrong/file.md\n\n> hello', 'hello')[0].status).toBe('ready');
  });
  it.each(['', ' \n', '# /only-heading.md'])('reports empty exports: %j', input => {
    expect(preview(input, 'text')).toEqual([expect.objectContaining({ status: 'format-error' })]);
  });
  it('reports prose and malformed quote prefixes, while allowing subsequent valid entries', () => {
    expect(preview('not an export\n\n>good\n\n> valid', 'valid').map(r => r.status)).toEqual(['format-error', 'format-error', 'ready']);
  });
  it('refuses empty quotes and recognizable quote/comment boundary ambiguity', () => {
    expect(preview('> ', 'text')[0].status).toBe('format-error');
    expect(preview('> first\ncomment\n> quoted comment', 'first')[0].status).toBe('format-error');
  });
  it('finds only unique exact occurrences, including overlapping matches', () => {
    expect(preview('> missing\n\n> aa\n\n> 😀', 'aaa 😀').map(r => r.status)).toEqual(['missing', 'ambiguous', 'ready']);
    expect(preview('> a  b', 'a b')[0].status).toBe('missing');
  });
  it('skips complete duplicates in storage and this batch, preserving different comments', () => {
    const old = annotation('hello', 'old', 2);
    const rows = preview('> hello\nold\n\n> hello\nnew\n\n> hello\nnew\n\n> hello', '--hello', [old]);
    expect(rows.map(r => r.status)).toEqual(['duplicate', 'ready', 'duplicate', 'ready']);
    expect(rows[1]).toMatchObject({ start: 2, end: 7, comment: 'new' });
    expect(old.comment).toBe('old');
  });
});
