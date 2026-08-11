import { invoke } from '@tauri-apps/api/core';
import { open as showOpenDialog } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store';
import { restoreAnnotations } from './annotations-db';
import {
  clipboardDocId,
  countChars,
  deriveClipboardTitle,
  fileDocId,
  hashText,
  makeSnippet,
  type NewDoc,
  type RecentDoc,
} from './recent-docs';
import { loadBody, recordOpen } from './recents-db';
import { SAMPLE_DOC, SAMPLE_DOC_PATH } from './sample-doc';

/**
 * The one way a document reaches the reader. Every entry point — file
 * association, dialog, drag-drop, clipboard, recents — funnels through here so
 * that opening and being remembered are never out of step.
 *
 * Annotations are read before the document reaches the store, since they have
 * to be there when the reader mounts; everything else about the document is
 * already known, so failing to read them opens it bare rather than not at all.
 *
 * Remembering, by contrast, is deliberately not awaited. The document is
 * already on screen by then, so a failed recents write is worth reporting but
 * must not come back as a rejection: callers read a rejection as "this document
 * would not open", and would wrongly blame the document for a database problem.
 */
async function open(doc: NewDoc): Promise<void> {
  const { openDoc, setError } = useAppStore.getState();
  const contentHash = hashText(doc.content);

  let note: string | null = null;
  const restored = await restoreAnnotations(doc.id, contentHash).catch((e) => {
    note = `Opened, but could not restore annotations: ${e}`;
    return { annotations: [], discarded: 0 };
  });
  if (restored.discarded === 1) {
    note = '1 annotation discarded: this document has changed since it was made';
  } else if (restored.discarded > 1) {
    note = `${restored.discarded} annotations discarded: this document has changed since they were made`;
  }

  openDoc({ ...doc, contentHash }, restored.annotations);
  if (note) setError(note);

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
  await open({
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

export function openClipboardText(text: string): Promise<void> {
  const title = deriveClipboardTitle(text, Date.now());
  // A clipboard document has no path, so its title stands in for one in exports.
  return open({ id: clipboardDocId(text), kind: 'clipboard', title, source: title, content: text });
}

/** The way in when there is no file to open: dev in a plain browser. */
export function openSampleDoc(): Promise<void> {
  return open({
    id: fileDocId(SAMPLE_DOC_PATH),
    kind: 'file',
    title: 'sample-document.md',
    source: SAMPLE_DOC_PATH,
    content: SAMPLE_DOC,
  });
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
  await open({ id: doc.id, kind: doc.kind, title: doc.title, source: doc.source, content: body });
}
