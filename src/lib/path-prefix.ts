/**
 * Reaching a document by the half of its path that never changes.
 *
 * Notes tend to live in a handful of directories and be named by hand, so the
 * whole path is mostly something already typed before. The prefix box remembers
 * those directories and completes them; the suffix box holds the only part that
 * is actually new. What comes out is an ordinary spec, and `doc-locator` reads
 * it exactly as it reads a pasted one — there is no second grammar here.
 *
 * The dialects each half can arrive in are `path-input`'s to undress, the same
 * as for the whole-path box: a half is a path too, just a shorter one.
 */

import { normalizePathInput } from './path-input';

/** How many prefixes are kept. Older ones fall off the end as new ones are used. */
export const PREFIXES_LIMIT = 50;

/** How many are put on screen at once, of however many match. */
export const PREFIX_SUGGESTIONS = 8;

/**
 * The path the two boxes name together.
 *
 * A separator is put between them, since a prefix is nearly always a directory
 * and typing its trailing slash every time is a nuisance. Three shapes already
 * say where the boundary is and are left as they are: a prefix ending in a
 * slash, a suffix starting with one, and — the one that would otherwise be
 * silently wrong — a prefix ending in the colon of `host:path`. A slash there
 * turns a path relative to the remote home into one from the remote root, which
 * is a different file and no error.
 */
export function joinPrefixSuffix(rawPrefix: string, rawSuffix: string): string {
  const prefix = normalizePathInput(rawPrefix);
  const suffix = normalizePathInput(rawSuffix);
  if (!prefix || !suffix) return prefix || suffix;

  // A rooted suffix keeps its own slash, so the prefix gives up any it has.
  if (suffix.startsWith('/')) return prefix.replace(/\/+$/, '') + suffix;
  if (prefix.endsWith('/') || prefix.endsWith(':')) return prefix + suffix;
  return `${prefix}/${suffix}`;
}

/**
 * The prefixes worth offering for what has been typed so far, most recently
 * used first — and all of them, in that order, while nothing has been typed.
 *
 * Matching is on any part of the prefix rather than only its start: a stored
 * prefix begins with `~/` or `/` or a host name, none of which anyone wants to
 * type again to find it, whereas the directory's own name is memorable. The
 * ones that do start with what was typed still come first, since typing the
 * beginning of a path is the most exact thing the box can be told.
 */
export function matchPrefixes(prefixes: string[], query: string, limit = PREFIX_SUGGESTIONS): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return prefixes.slice(0, limit);

  const starting: string[] = [];
  const containing: string[] = [];
  for (const prefix of prefixes) {
    const haystack = prefix.toLowerCase();
    if (haystack.startsWith(needle)) starting.push(prefix);
    else if (haystack.includes(needle)) containing.push(prefix);
  }
  return [...starting, ...containing].slice(0, limit);
}

/**
 * Record a prefix as the one just used: at the front, once, and only so many.
 * The same rule the upsert-and-prune in `path-prefixes-db` enforces in SQL,
 * kept here so it can be said once and tested — and so the browser fallback,
 * which has no SQL, has something to say it with.
 */
export function upsertPrefix(prefixes: string[], prefix: string, limit = PREFIXES_LIMIT): string[] {
  return [prefix, ...prefixes.filter((p) => p !== prefix)].slice(0, limit);
}
