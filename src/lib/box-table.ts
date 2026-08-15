// Bordered plain-text tables — the `┌─┬─┐` box drawing that CLI tools (Claude
// Code, mysql, psql \x off…) print — survive a copy-paste into a .md file, but
// Markdown sees only a paragraph and folds the whole grid into one garbled
// line. This module rewrites those blocks into GFM pipe tables *for rendering
// only*: the document content in the store stays byte-for-byte the source, so
// source view, stats and the content hash never see this transform.
//
// Two shapes are recognized, differing in what a separator line means:
// - a separator between *every* row (Claude CLI, reST grid): each group of
//   lines between separators is one logical row, wrapped cell lines merged;
// - a single separator under the header (mysql): every body line is a row.
// The first group is always the header. Anything that does not parse cleanly —
// truncated grid, uneven column counts, a single-column box — is left exactly
// as it was: a wrongly reconstructed table is worse than a garbled one.

const UNI_BORDER_CHARS = new Set('┌┬┐├┼┤└┴┘─');

type Family = 'unicode' | 'ascii';

function borderFamily(trimmed: string): Family | null {
  if (trimmed.length >= 3) {
    if ([...trimmed].every((ch) => UNI_BORDER_CHARS.has(ch)) && trimmed.includes('─')) return 'unicode';
    if (/^\+[-=+]+\+$/.test(trimmed) && /[-=]/.test(trimmed)) return 'ascii';
  }
  return null;
}

function rowFamily(trimmed: string): Family | null {
  if (trimmed.length >= 2) {
    if (trimmed.startsWith('│') && trimmed.endsWith('│')) return 'unicode';
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) return 'ascii';
  }
  return null;
}

function splitCells(trimmed: string, family: Family): string[] {
  const delimiter = family === 'unicode' ? '│' : '|';
  return trimmed
    .slice(1, -1)
    .split(delimiter)
    .map((cell) => cell.trim());
}

// One logical row from the lines wrapped inside it: per column, the non-empty
// fragments joined with a space.
function mergeRowGroup(group: string[][]): string[] {
  return group[0].map((_, col) =>
    group
      .map((line) => line[col])
      .filter((cell) => cell !== '')
      .join(' '),
  );
}

function renderRow(cells: string[], indent: string): string {
  return `${indent}| ${cells.map((cell) => cell.replaceAll('|', '\\|')).join(' | ')} |`;
}

interface TableBlock {
  rendered: string[];
  /** Index of the last source line the table consumed. */
  end: number;
}

// Try to read a bordered table starting at lines[start]; null leaves the
// document untouched from that line on.
function matchTable(lines: string[], start: number): TableBlock | null {
  const indent = lines[start].match(/^[ \t]*/)![0];
  // Four spaces of indent is an indented code block: verbatim text we must
  // not reinterpret.
  if (indent.includes('\t') || indent.length >= 4) return null;

  const top = lines[start].trim();
  const family = borderFamily(top);
  if (!family) return null;
  // The block must open with a *top* border, not a stray inner separator.
  if (family === 'unicode' && !(top.startsWith('┌') && top.endsWith('┐'))) return null;

  // Group content lines by the separator lines between them.
  const groups: string[][][] = [];
  let current: string[][] = [];
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (borderFamily(trimmed) === family) {
      if (current.length > 0) groups.push(current);
      current = [];
      end = i;
      if (family === 'unicode' && trimmed.startsWith('└')) break;
      continue;
    }
    if (rowFamily(trimmed) === family) {
      current.push(splitCells(trimmed, family));
      end = i;
      continue;
    }
    break;
  }
  // The grid must close with a border, with rows in between; for unicode the
  // loop above only records `end` on a border/row line, so a trailing border
  // is exactly `current` being empty at the point we stopped.
  if (current.length > 0 || borderFamily(lines[end].trim()) !== family) return null;
  if (family === 'ascii' && !(lines[end].trim().startsWith('+') && end > start)) return null;

  if (groups.length < 2) return null;
  const columns = groups[0][0].length;
  if (columns < 2) return null;
  if (!groups.every((group) => group.every((cells) => cells.length === columns))) return null;

  const header = mergeRowGroup(groups[0]);
  const body =
    groups.length === 2
      ? groups[1] // mysql style: one line per row
      : groups.slice(1).map(mergeRowGroup); // grid style: one group per row

  return {
    rendered: [
      renderRow(header, indent),
      `${indent}| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
      ...body.map((cells) => renderRow(cells, indent)),
    ],
    end,
  };
}

/**
 * Rewrite bordered plain-text tables in `markdown` into GFM pipe tables,
 * leaving everything else — including fenced and indented code blocks —
 * untouched. Feed the result to the renderer only, never to the store.
 */
export function convertBoxTables(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (fence) {
      out.push(line);
      if (trimmed.startsWith(fence) && new Set(trimmed).size === 1) fence = null;
      continue;
    }
    const opensFence = trimmed.match(/^(`{3,}|~{3,})/);
    if (opensFence) {
      fence = opensFence[1];
      out.push(line);
      continue;
    }

    const table = matchTable(lines, i);
    if (!table) {
      out.push(line);
      continue;
    }
    // A GFM table cannot interrupt a paragraph, so give it room to be one.
    if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    out.push(...table.rendered);
    const after = lines[table.end + 1];
    if (after !== undefined && after.trim() !== '') out.push('');
    i = table.end;
  }
  return out.join('\n');
}
