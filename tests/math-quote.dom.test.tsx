// @vitest-environment jsdom
//
// The other exception to "no component tests" (see `ime-keys.dom.test.tsx`):
// what is under test here is a fact about a DOM the app does not write by hand.
// The formula markup is KaTeX's, so the test renders the real pipeline and then
// reads a real `Range` back out of it — a hand-built fixture would only prove
// that the helper agrees with my guess at KaTeX's output.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMathDelimiters } from '../src/lib/math-source';
import { quoteFromRange, rehypeMathTex } from '../src/lib/math-quote';

/** The document exactly as `Reader` builds it. */
function render(markdown: string): HTMLElement {
  const html = renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeMathTex, [rehypeKatex, { output: 'html' }]]}
    >
      {normalizeMathDelimiters(markdown)}
    </ReactMarkdown>,
  );
  const article = document.createElement('article');
  article.innerHTML = html;
  document.body.replaceChildren(article);
  return article;
}

/** Every text node, in document order. */
function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
}

/** A range over everything, the way ⌘A then a highlight would leave it. */
function selectAll(root: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(root);
  return range;
}

/** A range from the first occurrence of `from` to the end of `to`. */
function selectBetween(root: HTMLElement, from: string, to: string): Range {
  const nodes = textNodes(root);
  const startNode = nodes.find((n) => n.data.includes(from));
  const endNode = nodes.find((n) => n.data.includes(to));
  if (!startNode || !endNode) throw new Error(`no text node for ${from} / ${to}`);
  const range = document.createRange();
  range.setStart(startNode, startNode.data.indexOf(from));
  range.setEnd(endNode, endNode.data.indexOf(to) + to.length);
  return range;
}

describe('quoteFromRange', () => {
  it('gives back the TeX of an inline formula, not its glyphs', () => {
    const article = render('The eigenvalue $\\lambda_1$ dominates.');
    expect(quoteFromRange(selectAll(article))).toBe('The eigenvalue $\\lambda_1$ dominates.');
  });

  it('reads a fraction in the order it was written', () => {
    // KaTeX lays a fraction out denominator-first, so the glyph text of
    // `\frac{a}{b}` is "ba". This is the whole reason the TeX is kept.
    const article = render('Take $\\frac{a}{b}$ now.');
    expect(quoteFromRange(selectAll(article))).toBe('Take $\\frac{a}{b}$ now.');
  });

  it('fences a display formula so it is still display once exported', () => {
    // The newline either side is the renderer's own separator between blocks;
    // the fence adds the second one, and a blank line around display math is
    // what every Markdown reader wants to see anyway.
    const article = render('Before\n\n$$\nE = mc^2\n$$\n\nAfter');
    expect(quoteFromRange(selectAll(article))).toBe('Before\n\n$$\nE = mc^2\n$$\n\nAfter');
  });

  it('fences a display formula written on one line too', () => {
    const article = render('$$E = mc^2$$');
    expect(quoteFromRange(selectAll(article))).toBe('$$\nE = mc^2\n$$');
  });

  it('takes the whole formula when the selection only reaches into it', () => {
    // Half an equation is not a quotable thing; the reader gets all of it.
    const article = render('Take $\\alpha+\\beta$ now.');
    const nodes = textNodes(article);
    const first = nodes.find((n) => n.data.includes('Take'))!;
    const inside = nodes.find((n) => n.data.includes('α'))!;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(inside, inside.data.length);
    expect(quoteFromRange(range)).toBe('Take $\\alpha+\\beta$');
  });

  it('handles several formulas in one selection', () => {
    const article = render('Both $a$ and $b$ hold.');
    expect(quoteFromRange(selectAll(article))).toBe('Both $a$ and $b$ hold.');
  });

  it('returns null when the selection holds no formula', () => {
    // Nothing to improve on, so the library's own quote is left alone.
    const article = render('Just some ordinary prose.');
    expect(quoteFromRange(selectAll(article))).toBeNull();
  });

  it('returns null for a selection beside, but not touching, a formula', () => {
    const article = render('Take $a$ now, and rest.');
    expect(quoteFromRange(selectBetween(article, 'now', 'rest'))).toBeNull();
  });

  it('keeps a formula out of an inline code span alone', () => {
    const article = render('Write `$x$` for math.');
    expect(quoteFromRange(selectAll(article))).toBeNull();
  });
});

describe('rehypeMathTex', () => {
  it('leaves the rendered text free of the TeX it stored', () => {
    // The attribute is the point: a *second* copy of the formula in the text
    // would shift every annotation offset after it.
    const article = render('The eigenvalue $\\lambda_1$ dominates.');
    expect(article.textContent).toBe('The eigenvalue λ1​ dominates.');
    expect(article.querySelector('[data-tex]')?.getAttribute('data-tex')).toBe('\\lambda_1');
  });

  it('marks a display formula as one', () => {
    const article = render('$$\nE = mc^2\n$$');
    const wrapper = article.querySelector('[data-tex]');
    expect(wrapper?.getAttribute('data-tex')).toBe('E = mc^2');
    expect(wrapper?.getAttribute('data-tex-display')).toBe('true');
  });

  it('covers a ```math fence as well', () => {
    const article = render('```math\nE = mc^2\n```');
    const wrapper = article.querySelector('[data-tex]');
    expect(wrapper?.getAttribute('data-tex')).toBe('E = mc^2');
    expect(wrapper?.getAttribute('data-tex-display')).toBe('true');
  });

  it('leaves an ordinary code block alone', () => {
    const article = render('```js\nconst a = 1;\n```');
    expect(article.querySelector('[data-tex]')).toBeNull();
  });

  it('keeps the TeX of a formula KaTeX could not parse', () => {
    const article = render('Broken $\\frobnicate{x}$ here.');
    expect(quoteFromRange(selectAll(article))).toBe('Broken $\\frobnicate{x}$ here.');
  });
});
