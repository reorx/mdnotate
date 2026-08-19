import type { Element, Node, Parent, Root, Text } from 'hast';

// Keeping the TeX of a formula reachable, and reading it back out of a
// selection — two halves of one idea, which is that a highlight through an
// equation should export as `$\lambda_1$` and not as whatever glyphs KaTeX
// happened to lay down.
//
// It has to be both halves because KaTeX's HTML is not the formula in any
// readable sense: it is positioned glyphs, laid out in painting order rather
// than reading order. `\frac{a}{b}` comes out as "ba", a matrix comes out
// column by column, and there are zero-width spaces between the pieces. That
// text is right for the reader's eye and wrong for everything downstream.
//
// The obvious alternative — asking KaTeX for MathML too, which carries the TeX
// in an `<annotation>` — is the one thing that cannot be done here: the
// annotator measures its offsets in characters of rendered text, and a second,
// invisible copy of every formula would move every offset after it.

/**
 * How `rehype-katex` is asked to render, kept here rather than at the call site
 * because both settings are consequences of what is written above.
 *
 * `output: 'html'` and not the default `htmlAndMathml`, for the reason just
 * given: the default lays every formula down twice, once as MathML and once as
 * glyphs, and both halves are text that nothing downstream can tell apart from
 * the visible one.
 *
 * `errorColor` is a custom property rather than a colour. KaTeX writes it
 * straight into a `style` attribute on the offending run — which beats any
 * stylesheet — so the only way a formula that does not parse can be legible on
 * both a white and a near-black page is to hand KaTeX something that already
 * knows the difference.
 */
export const KATEX_OPTIONS = { output: 'html', errorColor: 'var(--prose-error)' } as const;

/** Where the TeX is parked, and how a display formula is told from an inline one. */
const TEX_ATTRIBUTE = 'data-tex';
const DISPLAY_ATTRIBUTE = 'data-tex-display';

const isElement = (node: Node): node is Element => node.type === 'element';
const isText = (node: Node): node is Text => node.type === 'text';
const hasChildren = (node: Node): node is Parent => Array.isArray((node as Parent).children);

function classesOf(element: Element): unknown[] {
  const className = element.properties?.className;
  return Array.isArray(className) ? className : [];
}

/** The text of a subtree, which for a math node is the TeX exactly as written. */
function textOf(node: Node): string {
  if (isText(node)) return node.value;
  if (!hasChildren(node)) return '';
  return node.children.map(textOf).join('');
}

/**
 * Wrap every formula in an element carrying its TeX, before `rehype-katex` runs.
 *
 * It has to be a wrapper rather than an attribute on the formula itself:
 * rehype-katex does not decorate the node it renders, it splices it out of its
 * parent and puts KaTeX's markup in its place, so anything written onto that
 * node goes with it. A wrapper is left standing around the result.
 *
 * The node rehype-katex replaces is the one wrapped here, and it picks the same
 * two shapes remark-math emits: a `<code class="math-inline">`, or the `<pre>`
 * around a `<code class="math-display">` — the latter also being what a
 * ```math fence turns into.
 */
export function rehypeMathTex() {
  const isMathCode = (node: Node): boolean =>
    isElement(node) && node.tagName === 'code' && classesOf(node).includes('language-math');

  return (tree: Root): undefined => {
    const visit = (parent: Parent): undefined => {
      for (let i = 0; i < parent.children.length; i++) {
        const child = parent.children[i];
        if (!isElement(child)) continue;

        // Display math arrives as `<pre><code class="language-math">`, and it
        // is the `<pre>` that gets replaced, so the wrapper goes around it.
        if (child.tagName === 'pre' && child.children.some(isMathCode)) {
          parent.children[i] = wrap(child, textOf(child), true);
          continue;
        }
        // Inline math is the `<code>` itself.
        if (isMathCode(child)) {
          parent.children[i] = wrap(child, textOf(child), false);
          continue;
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

function wrap(scope: Element, tex: string, display: boolean): Element {
  return {
    type: 'element',
    tagName: display ? 'div' : 'span',
    properties: {
      [TEX_ATTRIBUTE]: tex.trim(),
      ...(display ? { [DISPLAY_ATTRIBUTE]: 'true' } : {}),
    },
    children: [scope],
  };
}

/**
 * A formula, written the way it would be written in Markdown.
 *
 * A display one is fenced on lines of its own, and given a blank side either
 * way, because `$$` only means display when it starts a line — a quote that ran
 * a paragraph straight into `$$` would export as literal dollar signs. The
 * surrounding newlines are trimmed off the finished quote.
 */
function delimited(tex: string, display: boolean): string {
  return display ? `\n$$\n${tex}\n$$\n` : `$${tex}$`;
}

function texOf(node: globalThis.Node): { tex: string; display: boolean } | null {
  if (!(node instanceof globalThis.Element)) return null;
  const tex = node.getAttribute(TEX_ATTRIBUTE);
  return tex === null ? null : { tex, display: node.getAttribute(DISPLAY_ATTRIBUTE) === 'true' };
}

/**
 * The text of a selection with every formula in it put back into TeX, or `null`
 * when the selection contains no formula at all.
 *
 * `null` is not a failure — it is the ordinary case, and it means the caller
 * should keep the quote the annotator already produced rather than a
 * near-identical one rebuilt here.
 *
 * A formula the selection only reaches into comes out whole: `cloneContents`
 * keeps a partially selected element, attributes and all, and half an equation
 * is not something anyone wants quoted.
 */
export function quoteFromRange(range: Range): string | null {
  const fragment = range.cloneContents();
  let found = false;

  const read = (node: globalThis.Node): string => {
    const math = texOf(node);
    if (math) {
      // An element the range only touched the edge of holds nothing of the
      // formula, and should not put one into the quote.
      if (node.textContent === '') return '';
      found = true;
      return delimited(math.tex, math.display);
    }
    if (node.nodeType === globalThis.Node.TEXT_NODE) return node.nodeValue ?? '';
    return Array.from(node.childNodes).map(read).join('');
  };

  const quote = read(fragment);
  return found ? quote.trim() : null;
}
