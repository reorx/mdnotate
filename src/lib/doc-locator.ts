/**
 * Where a document lives, and whether we can open it at all.
 *
 * Two spellings name a document: an absolute local path, and the scp form
 * `host:path`, where the host is whatever `~/.ssh/config` calls it. Telling
 * them apart comes down to one question — is there a colon before the first
 * slash? — which keeps `/notes/2026:08:11.md` local without having to know
 * anything about the machine it is read on.
 *
 * Links spell the same thing as `mdnotate://open?path=<spec>`. The path travels
 * as a query parameter rather than as the URL's own path because macOS parses
 * every incoming URL before handing it over and silently drops the ones that do
 * not parse — and `mdnotate://host:path/…` is one of those.
 *
 * `path-input` gets a path out of whatever dress it arrived in; this decides
 * what that path actually means.
 */

import { expandHome } from './path-input';
import { fileDocId, sshDocId } from './recent-docs';

/** How a document is shown: Markdown is rendered, everything else is read as it is. */
export type DocFormat = 'markdown' | 'text';

export interface FileLocator {
  kind: 'file';
  /** Absolute, with `~` already expanded. */
  path: string;
  format: DocFormat;
}

export interface SshLocator {
  kind: 'ssh';
  /** An alias, hostname, or `user@host` — resolved by ssh itself, not by us. */
  host: string;
  /** Relative to the remote home unless it starts at the root, as scp reads it. */
  path: string;
  format: DocFormat;
}

export type Locator = FileLocator | SshLocator;

export type LocatorResult = { ok: true; locator: Locator } | { ok: false; error: string };

const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd'];
const TEXT_EXTENSIONS = ['txt', 'text', 'log', 'json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'csv', 'tsv'];

/** Must stay in step with `openable_format` in `src-tauri/src/lib.rs`, which gates drag-drop. */
export const OPENABLE_EXTENSIONS = [...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS];

const MDNOTATE_URL = /^mdnotate:\/\//i;
/** Aliases, hostnames and `user@host`. Anything else is not something to hand to ssh. */
const SSH_HOST = /^[A-Za-z0-9._@-]+$/;

const LINK_SHAPE = 'Use mdnotate://open?path=<path>';
const ABSOLUTE_HINT = 'Enter an absolute path, starting with / or ~ — or a remote path like host:path';

function fail(error: string): LocatorResult {
  return { ok: false, error };
}

/** The last path segment, empty for a path naming a directory. */
function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * How to show what lives at this path, or null when we will not open it.
 * A name with no dot in it has no format to go on, so it is refused rather
 * than guessed at.
 */
export function docFormat(path: string): DocFormat | null {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown';
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  return null;
}

function formatError(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const what = dot > 0 ? `".${name.slice(dot + 1)}" documents` : 'a document without an extension';
  return `Cannot open ${what} — Markdown and plain text only`;
}

/**
 * Get the spec out of a link. Anything that is not a link is already one.
 *
 * A raw `&` or `#` cuts the query parameter short, so a link carrying one would
 * otherwise open whatever the truncated path happens to name. Both are caught
 * here instead.
 */
function unwrap(input: string): { ok: true; spec: string } | { ok: false; error: string } {
  if (!MDNOTATE_URL.test(input)) return { ok: true, spec: input };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: `Unrecognised mdnotate link. ${LINK_SHAPE}` };
  }
  if (url.host.toLowerCase() !== 'open' || (url.pathname !== '' && url.pathname !== '/')) {
    return { ok: false, error: `Unrecognised mdnotate link. ${LINK_SHAPE}` };
  }
  if (url.hash || [...url.searchParams.keys()].some((key) => key !== 'path')) {
    return { ok: false, error: 'A & or # inside a path has to be written as %26 or %23' };
  }
  const spec = url.searchParams.get('path');
  if (spec === null) return { ok: false, error: `That mdnotate link carries no path. ${LINK_SHAPE}` };
  return { ok: true, spec };
}

/** Where the colon that separates an ssh host from its path is, or -1. */
function hostSeparator(spec: string): number {
  const colon = spec.indexOf(':');
  if (colon <= 0) return -1;
  const slash = spec.indexOf('/');
  return slash === -1 || colon < slash ? colon : -1;
}

/**
 * Whether this input cannot be understood without knowing where home is.
 * Asking costs an IPC round trip, so it is worth only doing when there is a
 * `~` to expand — and a remote `~` is stripped rather than expanded, so it
 * does not count.
 */
export function needsHome(input: string): boolean {
  const unwrapped = unwrap(input);
  if (!unwrapped.ok) return false;
  const { spec } = unwrapped;
  return hostSeparator(spec) === -1 && (spec === '~' || spec.startsWith('~/'));
}

function parseFile(spec: string, home: string): LocatorResult {
  const path = expandHome(spec, home);
  if (!path.startsWith('/')) return fail(ABSOLUTE_HINT);
  const format = docFormat(path);
  if (!format) return fail(formatError(path));
  return { ok: true, locator: { kind: 'file', path, format } };
}

function parseSsh(spec: string, colon: number): LocatorResult {
  const host = spec.slice(0, colon);
  if (!SSH_HOST.test(host)) return fail(`"${host}" is not an SSH host mdnotate knows how to reach`);

  // A remote path is single-quoted before the remote shell sees it, so a ~ that
  // survived would be looked up literally. Bare relative already means home.
  let path = spec.slice(colon + 1);
  if (path === '~') path = '';
  else if (path.startsWith('~/')) path = path.slice(2);

  if (!path) return fail(`Add a path after "${host}:"`);
  const format = docFormat(path);
  if (!format) return fail(formatError(path));
  return { ok: true, locator: { kind: 'ssh', host, path, format } };
}

/**
 * Read a path, an scp-style remote path, or an mdnotate link into the document
 * it names. `home` expands a leading `~`; pass an empty string when it is not
 * known and such a path will be refused rather than half-resolved.
 */
export function parseLocator(input: string, home = ''): LocatorResult {
  const unwrapped = unwrap(input);
  if (!unwrapped.ok) return fail(unwrapped.error);

  const spec = unwrapped.spec.trim();
  if (!spec) return fail('Enter the path to a document');

  const colon = hostSeparator(spec);
  return colon === -1 ? parseFile(spec, home) : parseSsh(spec, colon);
}

/** How a document is written down: in Recent, in the path box, and in exports. */
export function formatLocator(locator: Locator): string {
  return locator.kind === 'file' ? locator.path : `${locator.host}:${locator.path}`;
}

/** Identity, and with it the rule for when re-opening collapses onto one entry. */
export function locatorDocId(locator: Locator): string {
  return locator.kind === 'file' ? fileDocId(locator.path) : sshDocId(locator.host, locator.path);
}

/** What the title bar and the Recent list call it. */
export function locatorTitle(locator: Locator): string {
  return basename(locator.path) || formatLocator(locator);
}
