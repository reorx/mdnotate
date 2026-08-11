/**
 * Making sense of a path typed or pasted into the home screen.
 *
 * The same file is written down in several dialects: dragged into a terminal it
 * comes back shell-escaped (`/My\ Notes/a.md`), copied out of a command it
 * keeps its quotes, copied from a browser it is a `file://` URL, and typed by
 * hand it usually starts at `~`. Spaces are ordinary characters in all of them,
 * so nothing here ever splits on whitespace — it is only trimmed at the ends.
 */

const FILE_URL = /^file:\/\/(?:localhost)?/;
const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

/**
 * Percent-decode what can be decoded and leave the rest alone: this is hand-
 * pasted text, and a stray `%` is not a reason to refuse the whole path.
 */
function decodePercentEscapes(text: string): string {
  return text.replace(PERCENT_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/** Strip one layer of surrounding quotes; `null` when the text is not quoted. */
function unquote(text: string): string | null {
  const quote = text[0];
  if ((quote !== '"' && quote !== "'") || text.length < 2 || !text.endsWith(quote)) return null;
  return text.slice(1, -1);
}

/**
 * The path an input box means, or an empty string when it means nothing yet.
 * A leading `~` survives untouched — only `expandHome` knows what it stands
 * for, and looking that up is worth doing only when there is a `~` to expand.
 */
export function normalizePathInput(raw: string): string {
  const trimmed = raw.trim();
  const quoted = unquote(trimmed);
  // Inside quotes a backslash is literal, exactly as a shell would read it.
  const path = quoted ?? trimmed.replace(/\\(.)/g, '$1');

  return FILE_URL.test(path) ? decodePercentEscapes(path.replace(FILE_URL, '')) : path;
}

/**
 * Put the home directory back where the `~` was. `~name` is someone else's
 * home, which we cannot resolve, so it is left alone and later refused.
 */
export function expandHome(path: string, home: string): string {
  if (path !== '~' && !path.startsWith('~/')) return path;
  const base = home.replace(/\/+$/, '');
  return base ? base + path.slice(1) : path;
}

/** Why a normalized path cannot be opened, or `null` when it can be. */
export function pathInputError(path: string): string | null {
  if (!path) return 'Enter the path to a Markdown file';
  if (!path.startsWith('/')) return 'Enter an absolute path, starting with / or ~';
  return null;
}
