import { describe, expect, it } from 'vitest';
import { joinFromEditor, splitForEditor } from '../src/lib/edit-text';

/**
 * A save writes back exactly the file the user had, plus their edits — not a
 * file the editor has quietly normalised. The editor works in bare `\n` text
 * with no byte-order mark; these are the two things it would otherwise strip.
 */

const roundTrip = (content: string) => {
  const { text, ...meta } = splitForEditor(content);
  return joinFromEditor(text, meta);
};

describe('splitForEditor / joinFromEditor', () => {
  it('leaves plain LF text as it is', () => {
    expect(splitForEditor('a\nb\n')).toEqual({ text: 'a\nb\n', bom: false, eol: '\n' });
    expect(roundTrip('a\nb\n')).toBe('a\nb\n');
  });

  it('hands a CRLF file to the editor as LF, and writes it back as CRLF', () => {
    expect(splitForEditor('a\r\nb\r\n')).toEqual({ text: 'a\nb\n', bom: false, eol: '\r\n' });
    expect(roundTrip('a\r\nb\r\n')).toBe('a\r\nb\r\n');
  });

  it('writes lines added in the editor with the file’s own line ending', () => {
    const { text, ...meta } = splitForEditor('a\r\nb');
    expect(joinFromEditor(`${text}\nc`, meta)).toBe('a\r\nb\r\nc');
  });

  it('strips a byte-order mark for editing and puts it back on save', () => {
    expect(splitForEditor('﻿# Title\n')).toEqual({ text: '# Title\n', bom: true, eol: '\n' });
    expect(roundTrip('﻿# Title\n')).toBe('﻿# Title\n');
  });

  it('keeps a byte-order mark and CRLF together', () => {
    expect(roundTrip('﻿a\r\nb\r\n')).toBe('﻿a\r\nb\r\n');
  });

  it('treats a file with mixed line endings as LF', () => {
    expect(splitForEditor('a\r\nb\nc').eol).toBe('\n');
  });

  it('treats a file with no line breaks at all as LF', () => {
    expect(splitForEditor('one line')).toEqual({ text: 'one line', bom: false, eol: '\n' });
  });
});
