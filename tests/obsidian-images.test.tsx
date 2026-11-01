import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkObsidianImages, hasObsidianImages } from '../src/lib/obsidian-images';
import { annotationContentHash, hashText, preListNumbersHash } from '../src/lib/recent-docs';

const render = (text: string) =>
  renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkObsidianImages]}>{text}</ReactMarkdown>);

describe('Obsidian image embeds', () => {
  it('renders JPG, WebP, Chinese names, spaces and underscores without parsing emphasis', () => {
    const html = render('before ![[照片 a_b_c.JPG|说明]] ![[图.webp]] after');
    expect(html).toContain(`src="${encodeURI('照片 a_b_c.JPG')}"`);
    expect(html).toContain('alt="说明"');
    expect(html).toContain(`src="${encodeURI('图.webp')}"`);
    expect(html).not.toContain('<em>');
  });
  it('sets numeric dimensions and leaves text suffixes as alt', () => {
    const html = render('![[a.jpg|300]] ![[b.webp|300x200]] ![[c.png|caption]]');
    expect(html).toContain('width="300"');
    expect(html).toContain('height="200"');
    expect(html).toContain('alt="caption"');
  });
  it('works in lists and GFM tables with escaped separators', () => {
    expect(render('- ![[a.jpg|200]]')).toContain('<img');
    const html = render('| image |\n| --- |\n| ![[a.webp\\|200]] |');
    expect(html).toContain('width="200"');
    expect(html).toContain('<td>');
  });
  it('preserves escapes, inline/fenced code, other embeds, and ordinary images', () => {
    const text =
      '\\![[a.jpg]] `![[b.webp]]`\n\n```md\n![[c.jpg]]\n```\n\n![[note]] ![[a.pdf]] [[a.jpg]] ![normal](normal.jpg)';
    const html = render(text);
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('![[a.jpg]]');
    expect(html).toContain('![[b.webp]]');
    expect(html).toContain('![[c.jpg]]');
    expect(html).toContain('![[a.pdf]]');
    expect(hasObsidianImages('`![[a.jpg]]`')).toBe(false);
    expect(hasObsidianImages('\\![[a.jpg]]')).toBe(false);
  });
  it('revises only affected Markdown hashes, after the list revision', () => {
    for (const text of ['![[a.webp]]', '---\ntitle: a\n---\n![[a.jpg]]']) {
      const hash = annotationContentHash(text, 'markdown');
      expect(hash).toMatch(/:list-numbers-v1:obsidian-images-v1$/);
      expect(preListNumbersHash(hash)).toBeNull();
      expect(annotationContentHash(text, 'text')).toBe(hashText(text));
    }
    expect(annotationContentHash('`![[a.jpg]]`', 'markdown')).toBe(hashText('`![[a.jpg]]`') + ':list-numbers-v1');
    expect(hasObsidianImages('before ![[a.jpg]] after')).toBe(true);
  });
});

it('does not revise YAML-only embeds and preserves image-adjacent rendered text', () => {
  const source = '---\nexample: "![[a.jpg]]"\n---\nplain';
  expect(annotationContentHash(source, 'markdown')).toBe(hashText(source) + ':front-matter-v1:list-numbers-v1');
  const html = render('before ![[a.jpg|caption]] after');
  expect(html).toContain('<p>before <img');
  expect(html).toContain('/> after</p>');
});
