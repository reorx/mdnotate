/**
 * The file as the editor sees it, and back.
 *
 * The editor keeps lines joined by a bare `\n` and has no notion of a
 * byte-order mark: given a CRLF file it would save LF, and given a leading BOM
 * it would show it as a stray character. Neither change is one the user made,
 * so both are taken off on the way in and put back on the way out — a save
 * writes the file they had plus their edits, and nothing else.
 *
 * Only a file that is CRLF throughout keeps CRLF. One with mixed endings has no
 * single convention to keep, and comes back LF.
 */

export interface EditMeta {
  bom: boolean;
  eol: '\n' | '\r\n';
}

const BOM = '﻿';

export function splitForEditor(content: string): EditMeta & { text: string } {
  const bom = content.startsWith(BOM);
  const body = bom ? content.slice(BOM.length) : content;
  const lineFeeds = body.split('\n').length - 1;
  const crlf = lineFeeds > 0 && body.split('\r\n').length - 1 === lineFeeds;
  return {
    text: crlf ? body.replaceAll('\r\n', '\n') : body,
    bom,
    eol: crlf ? '\r\n' : '\n',
  };
}

export function joinFromEditor(text: string, meta: EditMeta): string {
  const body = meta.eol === '\r\n' ? text.replaceAll('\n', '\r\n') : text;
  return meta.bom ? BOM + body : body;
}
