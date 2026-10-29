/**
 * Ordered list numbers are written into the rendered document as text, so they
 * can be selected, copied, found and quoted like the words after them. The
 * renderer half is checked through the real Markdown pipeline the reader uses;
 * the other half is the one-time move of annotations made while the numbers
 * were still drawn by the browser, and so missing from the text they counted.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Annotation } from '../src/lib/annotations';
import { rehypeListNumbers, remapToListNumbers, type TextSegment } from '../src/lib/list-numbers';

function render(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeListNumbers]}>
      {markdown}
    </ReactMarkdown>,
  );
}

const number = (n: number) => `<span class="list-number">${n}. </span>`;

describe('rehypeListNumbers', () => {
  it('writes each item’s number in front of its text', () => {
    const html = render('1. First\n2. Second\n');
    expect(html).toContain(`<li>${number(1)}First</li>`);
    expect(html).toContain(`<li>${number(2)}Second</li>`);
  });

  it('counts from the number the list starts at', () => {
    const html = render('3. Third\n4. Fourth\n');
    expect(html).toContain(`<li>${number(3)}Third</li>`);
    expect(html).toContain(`<li>${number(4)}Fourth</li>`);
  });

  it('numbers by position, whatever the source wrote on each line', () => {
    const html = render('1. a\n1. b\n1. c\n');
    expect(html).toContain(`${number(3)}c`);
  });

  it('numbers a nested list on its own', () => {
    const html = render('1. Outer\n   1. Inner one\n   2. Inner two\n2. Outer two\n');
    expect(html).toContain(`${number(1)}Inner one`);
    expect(html).toContain(`${number(2)}Inner two`);
    expect(html).toContain(`${number(2)}Outer two`);
  });

  it('puts the number inside the first paragraph of a loose item, so it shares that line', () => {
    const html = render('1. First\n\n2. Second\n');
    expect(html).toContain(`<li>\n<p>${number(1)}First</p>\n</li>`);
  });

  it('leaves bullet lists alone', () => {
    const html = render('- one\n- two\n');
    expect(html).not.toContain('list-number');
  });

  it('numbers a bullet list’s ordered sub-list, but not the bullets', () => {
    const html = render('- one\n  1. sub\n');
    expect(html).toContain(`<li>${number(1)}sub</li>`);
    expect(html.match(/list-number/g)).toHaveLength(1);
  });

  it('puts the number ahead of a task item’s checkbox', () => {
    const html = render('1. [ ] todo\n');
    expect(html).toMatch(new RegExp(`<li class="task-list-item">${number(1)}<input`));
  });
});

function make(partial: Partial<Annotation> & Pick<Annotation, 'id' | 'start' | 'end' | 'quote'>): Annotation {
  return { comment: null, createdAt: 1, updatedAt: 1, ...partial };
}

/** "Intro\n" then a two-item list, as the annotatable text nodes come out of the reader. */
const SEGMENTS: TextSegment[] = [
  { text: 'Intro\n', listNumber: false },
  { text: '1. ', listNumber: true },
  { text: 'apple', listNumber: false },
  { text: '\n', listNumber: false },
  { text: '2. ', listNumber: true },
  { text: 'banana', listNumber: false },
  { text: '\nOutro', listNumber: false },
];
// Before:  "Intro\napple\nbanana\nOutro"
// After:   "Intro\n1. apple\n2. banana\nOutro"

describe('remapToListNumbers', () => {
  it('keeps an annotation ahead of every list where it was', () => {
    const intro = make({ id: 'i', start: 0, end: 5, quote: 'Intro' });
    expect(remapToListNumbers([intro], SEGMENTS).kept).toEqual([intro]);
  });

  it('moves an annotation after a list past the numbers written before it', () => {
    const outro = make({ id: 'o', start: 19, end: 24, quote: 'Outro' });
    expect(remapToListNumbers([outro], SEGMENTS).kept).toEqual([{ ...outro, start: 25, end: 30 }]);
  });

  it('does not pull an item’s number into an annotation that starts at the item', () => {
    const apple = make({ id: 'a', start: 6, end: 11, quote: 'apple' });
    expect(remapToListNumbers([apple], SEGMENTS).kept).toEqual([{ ...apple, start: 9, end: 14 }]);
  });

  it('takes in the number between two items it spans, quote and all', () => {
    const both = make({ id: 'b', start: 6, end: 18, quote: 'apple\nbanana' });
    expect(remapToListNumbers([both], SEGMENTS).kept).toEqual([
      { ...both, start: 9, end: 24, quote: 'apple\n2. banana' },
    ]);
  });

  it('gives up on an annotation whose quote is not what its offsets point at', () => {
    const wrong = make({ id: 'w', start: 6, end: 11, quote: 'cherry' });
    const { kept, lost } = remapToListNumbers([wrong], SEGMENTS);
    expect(kept).toEqual([]);
    expect(lost).toEqual([wrong]);
  });

  it('changes nothing in a document with no numbered list', () => {
    const plain: TextSegment[] = [{ text: 'just prose', listNumber: false }];
    const prose = make({ id: 'p', start: 5, end: 10, quote: 'prose' });
    expect(remapToListNumbers([prose], plain)).toEqual({ kept: [prose], lost: [] });
  });
});
