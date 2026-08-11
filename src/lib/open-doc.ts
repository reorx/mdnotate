import { invoke } from '@tauri-apps/api/core';
import { open as showOpenDialog } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store';
import {
  clipboardDocId,
  countChars,
  deriveClipboardTitle,
  fileDocId,
  makeSnippet,
  type OpenDoc,
  type RecentDoc,
} from './recent-docs';
import { loadBody, recordOpen } from './recents-db';

/**
 * The one way a document reaches the reader. Every entry point — file
 * association, dialog, drag-drop, clipboard, recents — funnels through here so
 * that opening and being remembered are never out of step.
 *
 * Remembering is deliberately not awaited. The document is already on screen by
 * then, so a failed recents write is worth reporting but must not come back as
 * a rejection: callers read a rejection as "this document would not open", and
 * would wrongly blame the document for a database problem.
 */
function open(doc: OpenDoc): void {
  const { openDoc, setError } = useAppStore.getState();
  openDoc(doc);
  recordOpen({
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    source: doc.source,
    body: doc.kind === 'clipboard' ? doc.content : null,
    snippet: makeSnippet(doc.content),
    charCount: countChars(doc.content),
    openedAt: Date.now(),
  }).catch((e) => setError(`Opened, but could not add to Recent: ${e}`));
}

export async function openFilePath(path: string): Promise<void> {
  const content = await invoke<string>('read_markdown_file', { path });
  open({
    id: fileDocId(path),
    kind: 'file',
    title: path.split('/').pop() || path,
    source: path,
    content,
  });
}

export async function openFileDialog(): Promise<void> {
  const path = await showOpenDialog({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (typeof path === 'string') await openFilePath(path);
}

export function openClipboardText(text: string): void {
  const title = deriveClipboardTitle(text, Date.now());
  // A clipboard document has no path, so its title stands in for one in exports.
  open({ id: clipboardDocId(text), kind: 'clipboard', title, source: title, content: text });
}

/**
 * Re-open a recents entry. Files are re-read from disk — so a file edited
 * since it was last opened shows its current contents, and a file that has
 * moved away fails loudly — while clipboard text comes back from the database.
 */
export async function openRecent(doc: RecentDoc): Promise<void> {
  if (doc.kind === 'file') return openFilePath(doc.source);
  const body = await loadBody(doc.id);
  if (body === null) throw new Error(`Clipboard entry "${doc.title}" is no longer stored`);
  open({ id: doc.id, kind: doc.kind, title: doc.title, source: doc.source, content: body });
}
