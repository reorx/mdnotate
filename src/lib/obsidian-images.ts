/**
 * A micromark inline construct, rather than a text replacement: filenames are
 * consumed before emphasis and escapes, while fenced/inline code remains code.
 * GFM tables require an escaped pipe; accept that spelling as the separator.
 * The same parser drives hash detection so code examples do not lose anchors.
 */
import { fromMarkdown, type Extension as MdastExtension } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { Extension, Tokenizer, State } from 'micromark-util-types';
import type { Image } from 'mdast';
import type { Processor } from 'unified';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    obsidianImage: 'obsidianImage';
  }
}

export function parseObsidianImage(source: string) {
  const match = /^!\[\[([^\]\n]+)\]\]$/.exec(source);
  if (!match) return null;
  const [path, suffix = ''] = match[1].replace(/\\\|/g, '|').split('|');
  if (!/\.(?:jpe?g|png|gif|webp)$/i.test(path.trim())) return null;
  const size = /^([1-9]\d{0,4})(?:x([1-9]\d{0,4}))?$/.exec(suffix);
  return {
    path: path.trim(),
    alt: size ? '' : suffix,
    width: size ? Number(size[1]) : undefined,
    height: size?.[2] ? Number(size[2]) : undefined,
  };
}

const tokenize: Tokenizer = function (effects, ok, nok) {
  let source = '';
  return start;
  function start(code: number | null): State | undefined {
    if (code !== 33) return nok(code);
    effects.enter('obsidianImage');
    return consume(code);
  }
  function consume(code: number | null): State | undefined {
    if (code === null || code < 0) return nok(code);
    source += String.fromCharCode(code);
    if (source.length <= 3 && !'![['.startsWith(source)) return nok(code);
    effects.consume(code);
    if (source.endsWith(']]')) {
      if (!parseObsidianImage(source)) return nok;
      effects.exit('obsidianImage');
      return ok;
    }
    return consume;
  }
};
const syntax: Extension = { text: { 33: { name: 'obsidianImage', tokenize } } };
const mdast: MdastExtension = {
  enter: {
    obsidianImage(token) {
      const image = parseObsidianImage(this.sliceSerialize(token))!;
      this.enter(
        {
          type: 'image',
          url: image.path,
          alt: image.alt,
          title: null,
          data: {
            hProperties: {
              'data-obsidian': 'true',
              'data-image-reference': image.path,
              width: image.width,
              height: image.height,
            },
          },
        } as Image,
        token,
      );
    },
  },
  exit: {
    obsidianImage(token) {
      this.exit(token);
    },
  },
};

export function remarkObsidianImages(this: Processor) {
  const data = this.data() as { micromarkExtensions?: Extension[]; fromMarkdownExtensions?: MdastExtension[] };
  (data.micromarkExtensions ??= []).push(syntax);
  (data.fromMarkdownExtensions ??= []).push(mdast);
}

export function hasObsidianImages(content: string): boolean {
  if (!content.includes('![[')) return false;
  const tree = fromMarkdown(content, { extensions: [gfm(), syntax], mdastExtensions: [gfmFromMarkdown(), mdast] });
  function contains(node: { type: string; data?: unknown; children?: typeof tree.children }): boolean {
    if (node.type === 'image' && node.data) return true;
    return node.children?.some(contains) ?? false;
  }
  return contains(tree);
}
