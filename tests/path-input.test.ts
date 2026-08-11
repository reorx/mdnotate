import { describe, expect, it } from 'vitest';
import { expandHome, normalizePathInput } from '../src/lib/path-input';

const HOME = '/Users/me';

// A path typed or pasted into the home screen arrives in whatever dress its
// source gave it. Spaces survive all of them — nothing here ever splits on
// whitespace, it only trims the ends.
describe('normalizePathInput', () => {
  it('keeps a plain absolute path with spaces exactly as it is', () => {
    expect(normalizePathInput('/Users/me/My Notes/draft one.md')).toBe('/Users/me/My Notes/draft one.md');
  });

  it('trims surrounding whitespace and a trailing newline from a paste', () => {
    expect(normalizePathInput('  /tmp/My Notes/a.md\n')).toBe('/tmp/My Notes/a.md');
  });

  it('unescapes the backslashes a terminal drag leaves behind', () => {
    expect(normalizePathInput('/Users/me/My\\ Notes/draft\\ one.md')).toBe('/Users/me/My Notes/draft one.md');
  });

  it('unescapes other shell-escaped characters', () => {
    expect(normalizePathInput('/tmp/notes\\(1\\).md')).toBe('/tmp/notes(1).md');
  });

  it('strips surrounding double quotes and keeps the spaces inside them', () => {
    expect(normalizePathInput('"/Users/me/My Notes/a.md"')).toBe('/Users/me/My Notes/a.md');
  });

  it('strips surrounding single quotes', () => {
    expect(normalizePathInput("'/Users/me/My Notes/a.md'")).toBe('/Users/me/My Notes/a.md');
  });

  it('leaves backslashes inside quotes alone, as a shell would', () => {
    expect(normalizePathInput("'/tmp/back\\slash.md'")).toBe('/tmp/back\\slash.md');
  });

  it('leaves a leading ~ for expandHome to deal with', () => {
    expect(normalizePathInput(' ~/My Notes/a.md ')).toBe('~/My Notes/a.md');
  });

  it('turns a file:// URL into a path, decoding escaped spaces', () => {
    expect(normalizePathInput('file:///Users/me/My%20Notes/a.md')).toBe('/Users/me/My Notes/a.md');
  });

  it('decodes multi-byte escapes in a file:// URL', () => {
    expect(normalizePathInput('file:///tmp/%E4%B8%AD%E6%96%87.md')).toBe('/tmp/中文.md');
  });

  it('keeps malformed percent escapes rather than refusing the path', () => {
    expect(normalizePathInput('file:///tmp/a%zz.md')).toBe('/tmp/a%zz.md');
  });

  it('returns nothing for input that is only whitespace', () => {
    expect(normalizePathInput('   \n ')).toBe('');
  });

  // A link is not a dialect of a path — it is unwrapped by `doc-locator`, which
  // has to see the percent escapes intact to decode them as a URL would.
  it('hands an mdnotate link on untouched', () => {
    expect(normalizePathInput(' mdnotate://open?path=maiev.ts%3ASync%2Fa.md ')).toBe(
      'mdnotate://open?path=maiev.ts%3ASync%2Fa.md',
    );
  });

  it('leaves an scp-style remote path alone', () => {
    expect(normalizePathInput('maiev.ts:Sync/My Notes/a.md')).toBe('maiev.ts:Sync/My Notes/a.md');
  });
});

describe('expandHome', () => {
  it('expands a leading ~ and keeps the spaces after it', () => {
    expect(expandHome('~/My Notes/a.md', HOME)).toBe('/Users/me/My Notes/a.md');
  });

  it('tolerates a home directory given with a trailing slash', () => {
    expect(expandHome('~/a.md', '/Users/me/')).toBe('/Users/me/a.md');
  });

  it('expands a bare ~', () => {
    expect(expandHome('~', HOME)).toBe(HOME);
  });

  it('leaves ~ in place when home is unknown', () => {
    expect(expandHome('~/a.md', '')).toBe('~/a.md');
  });

  it("does not touch another user's ~name", () => {
    expect(expandHome('~other/a.md', HOME)).toBe('~other/a.md');
  });

  it('leaves an ordinary absolute path alone', () => {
    expect(expandHome('/tmp/a b.md', HOME)).toBe('/tmp/a b.md');
  });
});
