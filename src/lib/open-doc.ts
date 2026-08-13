import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { open as showOpenDialog } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store';
import { restoreAnnotations } from './annotations-db';
import {
  formatLocator,
  locatorDocId,
  locatorTitle,
  needsHome,
  parseLocator,
  OPENABLE_EXTENSIONS,
  type Locator,
} from './doc-locator';
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
import { createLatest } from './latest';
import { loadBody, recordOpen } from './recents-db';
import { SAMPLE_DOC, SAMPLE_DOC_PATH } from './sample-doc';
import { isTauri } from './tauri-env';
import { announceDoc } from './window-doc';

/**
 * Every open this window has been asked for, so that a slow one cannot land on
 * top of a quicker one asked for after it. Per module, which is per window:
 * each window has its own reader and its own idea of what it is showing.
 */
const opens = createLatest();

/**
 * The one way a document reaches the reader. Every entry point — file
 * association, dialog, drag-drop, clipboard, recents — funnels through here so
 * that opening and being remembered are never out of step.
 *
 * `attempt` is the ticket its caller took before it started fetching anything;
 * a document superseded while it was on its way is dropped here rather than
 * shown, since by then the user has asked for something else.
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
async function open(doc: NewDoc, attempt: number): Promise<void> {
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

  if (!opens.isCurrent(attempt)) return;
  openDoc({ ...doc, contentHash }, restored.annotations);
  announceDoc();
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

/**
 * Fetch a document's text, from this machine or another one.
 *
 * A local read answers with the path it actually resolved to, and that is the
 * locator the document is then known by: `/tmp/a.md` and `/private/tmp/a.md`
 * name one file, and one file should not become two recents entries — each
 * with its own annotations — depending on which door it came in by.
 */
async function readLocator(locator: Locator): Promise<{ locator: Locator; content: string }> {
  if (locator.kind !== 'file') {
    const content = await invoke<string>('read_remote_file', { host: locator.host, path: locator.path });
    return { locator, content };
  }
  const file = await invoke<{ path: string; content: string }>('read_local_file', { path: locator.path });
  return { locator: { ...locator, path: file.path }, content: file.content };
}

/**
 * Open the document a locator names. Reading it can mean a connection to
 * another machine, which is slow enough to need saying so — the reader keeps
 * showing whatever it had until the new text actually arrives.
 */
export async function openLocator(locator: Locator): Promise<void> {
  const { setOpening } = useAppStore.getState();
  const opening = formatLocator(locator);
  const attempt = opens.start();
  setOpening(opening);
  try {
    const found = await readLocator(locator);
    await open(
      {
        id: locatorDocId(found.locator),
        kind: found.locator.kind,
        title: locatorTitle(found.locator),
        source: formatLocator(found.locator),
        content: found.content,
        format: found.locator.format,
      },
      attempt,
    );
  } catch (e) {
    // A window is claimed for the document the moment one is routed to it, so
    // one that could not be read has to be owned up to: otherwise the window
    // goes on standing in for a document it never managed to show, and opening
    // that document again would only raise it. Success needs nothing here —
    // `open` has already said what the window holds.
    announceDoc();
    throw e;
  } finally {
    // Only ours to clear: a second open started meanwhile owns the indicator.
    if (useAppStore.getState().opening === opening) setOpening(null);
  }
}

/**
 * Open whatever a path box, a link, or the OS handed us. This is where a spec
 * stops being text and becomes a document; every caller that starts from a
 * string comes through here so the grammar is applied in exactly one place.
 */
export async function openSpec(input: string): Promise<void> {
  // Where home is has to be asked for, so only ask when there is a ~ to expand.
  const home = needsHome(input) && isTauri ? await homeDir() : '';
  const result = parseLocator(input, home);
  if (!result.ok) throw new Error(result.error);
  await openLocator(result.locator);
}

export async function openFileDialog(): Promise<void> {
  const path = await showOpenDialog({
    multiple: false,
    filters: [{ name: 'Documents', extensions: [...OPENABLE_EXTENSIONS] }],
  });
  if (typeof path === 'string') await openSpec(path);
}

export function openClipboardText(text: string): Promise<void> {
  const title = deriveClipboardTitle(text, Date.now());
  // A clipboard document has no path, so its title stands in for one in exports.
  return open(
    {
      id: clipboardDocId(text),
      kind: 'clipboard',
      title,
      source: title,
      content: text,
      format: 'markdown',
    },
    opens.start(),
  );
}

/** The way in when there is no file to open: dev in a plain browser. */
export function openSampleDoc(): Promise<void> {
  return open(
    {
      id: fileDocId(SAMPLE_DOC_PATH),
      kind: 'file',
      title: 'sample-document.md',
      source: SAMPLE_DOC_PATH,
      content: SAMPLE_DOC,
      format: 'markdown',
    },
    opens.start(),
  );
}

/**
 * Re-open a recents entry. Files are re-read, from disk or over ssh — so one
 * edited since it was last opened shows its current contents, and one that has
 * moved away fails loudly — while clipboard text comes back from the database.
 */
export async function openRecent(doc: RecentDoc): Promise<void> {
  if (doc.kind !== 'clipboard') return openSpec(doc.source);
  const attempt = opens.start();
  const body = await loadBody(doc.id);
  if (body === null) throw new Error(`Clipboard entry "${doc.title}" is no longer stored`);
  await open(
    {
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      source: doc.source,
      content: body,
      format: 'markdown',
    },
    attempt,
  );
}
