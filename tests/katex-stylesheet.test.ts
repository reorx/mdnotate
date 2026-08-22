import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import rehypeKatex from 'rehype-katex';
import { describe, expect, it } from 'vitest';
import { KATEX_OPTIONS } from '../src/lib/math-quote';

// KaTeX is two halves that have to be the same version, and nothing but this
// file says so. `rehype-katex` renders with the copy of `katex` it depends on;
// `App.tsx` paints with the stylesheet of the copy *we* depend on. Nothing in
// either package complains when those drift — the markup still comes out, it
// just stops matching any rule.
//
// That is not hypothetical: KaTeX 0.18 renamed its layout classes (`.stretchy`
// → `.katex-stretchy`, `.base`/`.strut` likewise) while `rehype-katex@7` still
// pins `katex@^0.16`, so shipping the 0.18 stylesheet left `\boxed{…}` with a
// frame that had no `width` rule and therefore no visible box.
//
// Both tests reach into the resolved dependency tree on purpose: the drift is
// in the packages, so there is nothing in `src/` to ask instead.

const require = createRequire(import.meta.url);

/** The stylesheet `App.tsx` imports, read through the very same specifier. */
const stylesheet = readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8');

/** Whether the stylesheet has a rule for a class, and not merely one whose name ends in it. */
function styles(className: string): boolean {
  return new RegExp(`\\.${className}(?![\\w-])`).test(stylesheet);
}

/** The classes of every element in a formula rendered the way the Reader renders it. */
function renderClasses(tex: string): { className: string[]; style: string }[] {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: { className: ['language-math', 'math-display'] },
        children: [{ type: 'text', value: tex }],
      },
    ],
  };
  // A rehype plugin is a function returning a transformer; the file is only
  // touched to report a formula that does not parse, and these do.
  (rehypeKatex as (options: typeof KATEX_OPTIONS) => (tree: unknown, file: unknown) => void)(KATEX_OPTIONS)(tree, {
    message: () => {},
  });

  const found: { className: string[]; style: string }[] = [];
  const walk = (node: Record<string, unknown>) => {
    const properties = (node.properties ?? {}) as { className?: unknown; style?: unknown };
    if (Array.isArray(properties.className)) {
      found.push({ className: properties.className.map(String), style: String(properties.style ?? '') });
    }
    for (const child of (node.children ?? []) as Record<string, unknown>[]) walk(child);
  };
  walk(tree as unknown as Record<string, unknown>);
  return found;
}

describe('the KaTeX stylesheet and the KaTeX that renders', () => {
  it('are the same version', () => {
    const rendering = createRequire(require.resolve('rehype-katex'))('katex/package.json') as { version: string };
    const painting = require('katex/package.json') as { version: string };
    expect(rendering.version).toBe(painting.version);
  });

  it('agree on the classes that give a \\boxed frame its size', () => {
    // The frame is the one element KaTeX gives a border in a `style`
    // attribute; everything it needs beyond that — `width: 100%`, above all —
    // comes from the stylesheet by class.
    const frames = renderClasses('\\boxed{a = b}').filter((el) => el.style.includes('border-style'));

    expect(frames).toHaveLength(1);
    for (const className of frames[0].className) expect([className, styles(className)]).toEqual([className, true]);
  });
});
