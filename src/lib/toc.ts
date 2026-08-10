export interface HeadingInfo {
  level: number;
  text: string;
}

export interface TocItem {
  id: string;
  level: number;
  text: string;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'section';
}

/** Assign unique slug ids to headings, in document order. */
export function buildToc(headings: HeadingInfo[]): TocItem[] {
  const used = new Map<string, number>();
  return headings.map(({ level, text }) => {
    const base = slugify(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return { id: count === 0 ? base : `${base}-${count}`, level, text };
  });
}
