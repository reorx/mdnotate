import { describe, expect, it } from 'vitest';
import {
  docFormat,
  formatLocator,
  locatorDocId,
  locatorTitle,
  needsHome,
  parseLocator,
  type Locator,
} from '../src/lib/doc-locator';

const HOME = '/Users/me';

/** Unwrap a parse that is expected to succeed, so the tests below stay one-liners. */
function loc(input: string, home = HOME): Locator {
  const result = parseLocator(input, home);
  if (!result.ok) throw new Error(`expected ${input} to parse, got: ${result.error}`);
  return result.locator;
}

/** The error a parse is expected to fail with. */
function err(input: string, home = HOME): string {
  const result = parseLocator(input, home);
  if (result.ok) throw new Error(`expected ${input} to be refused, got: ${formatLocator(result.locator)}`);
  return result.error;
}

// A document is named either by an absolute local path or, scp-style, by an SSH
// host and a path behind it. Which one it is comes down to a single question:
// is there a colon before the first slash?
describe('parseLocator on local paths', () => {
  it('reads an absolute path as a local file', () => {
    expect(loc('/Users/me/notes/a.md')).toEqual({ kind: 'file', path: '/Users/me/notes/a.md', format: 'markdown' });
  });

  it('keeps the spaces in a local path', () => {
    expect(loc('/Users/me/My Notes/draft one.md').path).toBe('/Users/me/My Notes/draft one.md');
  });

  it('expands a leading ~ against the home it is given', () => {
    expect(loc('~/Sync/a.md').path).toBe('/Users/me/Sync/a.md');
  });

  it('reads a colon after the first slash as part of the filename, not a host', () => {
    expect(loc('/Users/me/notes/2026:08:11.md')).toEqual({
      kind: 'file',
      path: '/Users/me/notes/2026:08:11.md',
      format: 'markdown',
    });
  });

  it('refuses a relative path, naming both shapes that would work', () => {
    expect(err('notes/a.md')).toMatch(/absolute/i);
    expect(err('notes/a.md')).toMatch(/host:path/i);
  });

  it('refuses a ~ that could not be expanded, because home was never looked up', () => {
    expect(err('~/Sync/a.md', '')).toMatch(/absolute/i);
  });

  it("refuses another user's ~name, which is not ours to expand", () => {
    expect(err('~other/a.md')).toMatch(/absolute/i);
  });

  it('asks for something when given nothing', () => {
    expect(err('')).toMatch(/path/i);
  });
});

// scp spelling: everything after the colon is relative to the remote home,
// exactly as `scp host:Sync/a.md` would be, unless it starts at the root.
describe('parseLocator on SSH paths', () => {
  it('reads host:path as a path under the remote home', () => {
    expect(loc('maiev.ts:Sync/kb/contract.md')).toEqual({
      kind: 'ssh',
      host: 'maiev.ts',
      path: 'Sync/kb/contract.md',
      format: 'markdown',
    });
  });

  it('keeps a remote path that starts at the root absolute', () => {
    expect(loc('maiev.ts:/etc/notes.md').path).toBe('/etc/notes.md');
  });

  it('strips a leading ~/ rather than passing it to a shell that will not expand it', () => {
    // The remote path is single-quoted before it reaches the remote shell, so a
    // surviving ~ would be looked up literally and never found.
    expect(loc('maiev.ts:~/Sync/a.md').path).toBe('Sync/a.md');
  });

  it('keeps the spaces in a remote path', () => {
    expect(loc('maiev.ts:Sync/My Notes/a.md').path).toBe('Sync/My Notes/a.md');
  });

  it('accepts a host carrying a user', () => {
    expect(loc('reorx@maiev.ts:Sync/a.md').host).toBe('reorx@maiev.ts');
  });

  it('does not lowercase a host, since SSH aliases are matched as written', () => {
    expect(loc('Maiev.TS:Sync/a.md').host).toBe('Maiev.TS');
  });

  it('refuses a host with nothing behind the colon', () => {
    expect(err('maiev.ts:')).toMatch(/maiev\.ts/);
  });

  it('refuses a bare ~ behind the colon, which names a directory', () => {
    expect(err('maiev.ts:~')).toMatch(/maiev\.ts/);
  });

  it('refuses a host that looks like a command-line flag', () => {
    expect(err('-oProxyCommand=x:a.md')).toMatch(/host/i);
  });

  it('refuses a host with a space in it', () => {
    expect(err('my host:a.md')).toMatch(/host/i);
  });
});

// Markdown is rendered; the plain-text formats are shown as they are; anything
// else is refused before a connection is ever opened.
describe('docFormat', () => {
  it('recognises the Markdown extensions', () => {
    for (const ext of ['md', 'markdown', 'mdown', 'mkd']) {
      expect(docFormat(`/tmp/a.${ext}`)).toBe('markdown');
    }
  });

  it('ignores the case an extension is written in', () => {
    expect(docFormat('/tmp/README.MD')).toBe('markdown');
  });

  it('recognises the plain-text extensions', () => {
    for (const ext of ['txt', 'text', 'log', 'json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'csv', 'tsv']) {
      expect(docFormat(`/tmp/a.${ext}`)).toBe('text');
    }
  });

  it('refuses anything else', () => {
    expect(docFormat('/tmp/a.pdf')).toBeNull();
    expect(docFormat('/tmp/a.png')).toBeNull();
  });

  it('refuses a file with no extension at all', () => {
    expect(docFormat('/tmp/README')).toBeNull();
  });

  it('refuses a path that ends in a slash, which names a directory', () => {
    expect(docFormat('/tmp/notes/')).toBeNull();
  });

  it('does not mistake a dot in a parent directory for the file extension', () => {
    expect(docFormat('/tmp/v1.2/README')).toBeNull();
  });
});

describe('parseLocator on the formats it will not open', () => {
  it('names the extension it is refusing', () => {
    expect(err('/tmp/report.pdf')).toMatch(/pdf/);
  });

  it('refuses a remote path by its extension, before any connection is opened', () => {
    expect(err('maiev.ts:Sync/photo.png')).toMatch(/png/);
  });

  it('carries the format through for plain text', () => {
    expect(loc('/tmp/deploy.log').format).toBe('text');
    expect(loc('maiev.ts:var/log/deploy.log').format).toBe('text');
  });
});

// Links arrive as mdnotate://open?path=<path>. The path is a query parameter
// precisely so a colon in it survives: macOS parses every incoming URL and
// silently drops the ones it cannot make sense of.
describe('parseLocator on mdnotate URLs', () => {
  it('opens the local path a link carries', () => {
    expect(loc('mdnotate://open?path=/Users/me/notes/a.md').path).toBe('/Users/me/notes/a.md');
  });

  it('opens the remote path a link carries', () => {
    expect(loc('mdnotate://open?path=maiev.ts:Sync/kb/contract.md')).toEqual({
      kind: 'ssh',
      host: 'maiev.ts',
      path: 'Sync/kb/contract.md',
      format: 'markdown',
    });
  });

  it('decodes a percent-escaped path', () => {
    expect(loc('mdnotate://open?path=maiev.ts%3ASync%2Fmy%20notes.md')).toEqual({
      kind: 'ssh',
      host: 'maiev.ts',
      path: 'Sync/my notes.md',
      format: 'markdown',
    });
  });

  it('decodes a multi-byte escaped path', () => {
    expect(loc('mdnotate://open?path=/tmp/%E4%B8%AD%E6%96%87.md').path).toBe('/tmp/中文.md');
  });

  it('expands a ~ carried by a link', () => {
    expect(loc('mdnotate://open?path=~/Sync/a.md').path).toBe('/Users/me/Sync/a.md');
  });

  it('tolerates the trailing slash a link might be written with', () => {
    expect(loc('mdnotate://open/?path=/tmp/a.md').path).toBe('/tmp/a.md');
  });

  it('ignores the case the scheme and action are written in', () => {
    expect(loc('MDNOTATE://OPEN?path=/tmp/a.md').path).toBe('/tmp/a.md');
  });

  it('refuses a link with no action, naming the shape that works', () => {
    expect(err('mdnotate://maiev.ts/Sync/a.md')).toMatch(/mdnotate:\/\/open\?path=/);
  });

  it('refuses a link with an action it does not know', () => {
    expect(err('mdnotate://export?path=/tmp/a.md')).toMatch(/mdnotate:\/\/open\?path=/);
  });

  it('refuses a link with no path at all', () => {
    expect(err('mdnotate://open')).toMatch(/mdnotate:\/\/open\?path=/);
  });

  it('refuses an empty path rather than opening nothing', () => {
    expect(err('mdnotate://open?path=')).toMatch(/path/i);
  });

  // A raw & ends the query parameter, so the path silently loses its tail. Say
  // so, rather than opening whatever the truncated path happens to name.
  it('explains that a & in a path has to be escaped', () => {
    expect(err('mdnotate://open?path=/tmp/a&b.md')).toMatch(/%26/);
  });
});

describe('needsHome', () => {
  it('is true for a bare ~ path, which cannot be resolved without asking', () => {
    expect(needsHome('~/Sync/a.md')).toBe(true);
  });

  it('is true for a ~ path carried by a link', () => {
    expect(needsHome('mdnotate://open?path=~/Sync/a.md')).toBe(true);
  });

  it('is false for an absolute path, so nothing has to be looked up', () => {
    expect(needsHome('/Users/me/a.md')).toBe(false);
  });

  it('is false for a remote ~, which is stripped rather than expanded', () => {
    expect(needsHome('maiev.ts:~/Sync/a.md')).toBe(false);
  });
});

// The canonical spelling of a document: what Recent stores, what the export
// template renders, and what a user can paste back into the path box.
describe('formatLocator', () => {
  it('writes a local document as its path', () => {
    expect(formatLocator(loc('/Users/me/a.md'))).toBe('/Users/me/a.md');
  });

  it('writes a remote document scp-style, the way it was typed', () => {
    expect(formatLocator(loc('maiev.ts:Sync/kb/contract.md'))).toBe('maiev.ts:Sync/kb/contract.md');
  });

  it('round-trips a link back into a spec that parses to the same thing', () => {
    const once = loc('mdnotate://open?path=maiev.ts%3ASync%2Fa%20b.md');
    expect(loc(formatLocator(once))).toEqual(once);
  });
});

describe('locatorDocId', () => {
  it('identifies a local document by its path, so re-opening it collapses', () => {
    expect(locatorDocId(loc('/Users/me/a.md'))).toBe('file:/Users/me/a.md');
  });

  it('identifies a remote document by host and path together', () => {
    expect(locatorDocId(loc('maiev.ts:Sync/a.md'))).toBe('ssh:maiev.ts:Sync/a.md');
  });

  it('keeps the same path on two hosts apart', () => {
    expect(locatorDocId(loc('maiev.ts:Sync/a.md'))).not.toBe(locatorDocId(loc('harrogath.ts:Sync/a.md')));
  });

  it('keeps a remote document apart from a local one at the same path', () => {
    expect(locatorDocId(loc('maiev.ts:/Users/me/a.md'))).not.toBe(locatorDocId(loc('/Users/me/a.md')));
  });
});

describe('locatorTitle', () => {
  it('names a local document after its file', () => {
    expect(locatorTitle(loc('/Users/me/notes/contract.md'))).toBe('contract.md');
  });

  it('names a remote document after its file too', () => {
    expect(locatorTitle(loc('maiev.ts:Sync/kb/contract.md'))).toBe('contract.md');
  });

  it('falls back to the whole path when there are no slashes to cut at', () => {
    expect(locatorTitle(loc('maiev.ts:contract.md'))).toBe('contract.md');
  });
});
