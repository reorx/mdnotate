/**
 * YAML front matter belongs only at the very beginning of a Markdown file.
 * Split it before any rendering transforms, without changing the stored source.
 * An unclosed fence stays ordinary Markdown; a closed but invalid YAML block
 * is still metadata and is displayed verbatim instead of becoming a heading.
 */
import { isMap, isScalar, parseDocument } from 'yaml';

export interface FrontMatterBlock {
  yaml: string;
  body: string;
}

export interface FrontMatterField {
  key: string;
  value: string;
  structured: boolean;
}

/** Accept a UTF-8 BOM, LF/CRLF, and either YAML end marker at column zero. */
export function splitFrontMatter(markdown: string): FrontMatterBlock | null {
  const opening = markdown.match(/^\uFEFF?---[ \t]*\r?\n/);
  if (!opening) return null;
  const rest = markdown.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) return null;
  return {
    yaml: rest.slice(0, closing.index),
    body: rest.slice(closing.index + closing[0].length),
  };
}

/** A block collection's range starts after its first line's indentation.
 * Remove that same prefix from subsequent lines to keep siblings aligned. */
function collectionSource(yaml: string, start: number, end: number): string {
  const source = yaml.slice(start, end).trimEnd();
  const prefix = yaml.slice(yaml.lastIndexOf('\n', start - 1) + 1, start);
  if (!/^[ \t]+$/.test(prefix)) return source;
  return source.split('\n').map((line, index) =>
    index > 0 && line.startsWith(prefix) ? line.slice(prefix.length) : line,
  ).join('\n');
}

/**
 * Return ordered fields, or null to request a verbatim fallback. parseDocument
 * reports malformed YAML through `errors`, rather than throwing like parse().
 * Read nodes directly: expanding aliases into JS can throw or create cycles.
 * Collections and aliases retain their source spelling; scalar strings use
 * YAML's decoded value so quoted and folded descriptions read naturally.
 */
export function parseFrontMatter(yaml: string): FrontMatterField[] | null {
  const document = parseDocument(yaml, { prettyErrors: false });
  if (document.errors.length || document.warnings.length || !isMap(document.contents)) return null;
  if (document.contents.items.some(({ key }) => !isScalar(key) || typeof key.value !== 'string')) return null;

  return document.contents.items.map(({ key, value }) => {
    const structured = value !== null && !isScalar(value);
    const range = value?.range;
    return {
      key: String(isScalar(key) ? key.value : ''),
      value: structured && range
        ? collectionSource(yaml, range[0], range[1])
        : String(isScalar(value) ? value.value ?? 'null' : 'null'),
      structured,
    };
  });
}
