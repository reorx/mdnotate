import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';
import { rebaseAnnotations } from './annotations-db';
import { writeDocFile } from './doc-file';
import { askToOverwrite, askToSave } from './edit-prompts';
import { joinFromEditor, type EditMeta } from './edit-text';
import { reanchorAnnotations } from './reanchor';
import { annotationContentHash, countChars, describeEdit, makeSnippet } from './recent-docs';
import { recordOpen } from './recents-db';

/**
 * The one way editing happens: going in, saving, and — above all — getting
 * out. Like `annotate` and `open-doc`, everything that changes the edit state
 * comes through here, so the rules are stated once:
 *
 * - **Nothing leaves the editor without asking.** The View button, closing the
 *   window, quitting, and opening anything else in this window all call
 *   `confirmLeaveEdits` first. With unsaved changes that asks Save / Don't Save
 *   / Cancel; with none it lets go without a word.
 * - **A save is a write, then the store.** The file on disk changes first; only
 *   then does the document in the store take the new text, which is what sets
 *   the reader re-rendering and the annotations moving (`rebaseAfterSave`).
 *
 * The editor's text is not in the store — a keystroke should not re-render the
 * app — so the live editor registers itself here and is asked for its text
 * when there is something to save. Module state, which is window state: each
 * window has its own reader and its own editor.
 */

/** What the session needs from the editor on screen. */
export interface LiveEditor {
  /** The text as it stands, lines joined by `\n`. */
  text(): string;
  /** `text` is now what the file holds: compare future edits against it. */
  markSaved(text: string): void;
  /** How the file's own text differs from the editor's, to be restored on save. */
  meta: EditMeta;
}

let live: LiveEditor | null = null;
let saving: Promise<boolean> | null = null;

/** Called by the editor as it mounts; the returned function, as it goes. */
export function attachEditor(editor: LiveEditor): () => void {
  live = editor;
  return () => {
    if (live === editor) live = null;
  };
}

export function startEditing(): void {
  const { doc, setEditing } = useAppStore.getState();
  if (describeEdit(doc).canEdit) setEditing(true);
}

/** The View button. */
export async function stopEditing(): Promise<void> {
  if (await confirmLeaveEdits()) useAppStore.getState().setEditing(false);
}

/**
 * Whether whatever is about to replace the editor may go ahead. True once the
 * changes are saved or let go, or when there were none; false when the user
 * would rather stay — or chose Save and the save did not happen.
 */
export async function confirmLeaveEdits(): Promise<boolean> {
  const { doc, editing, dirty } = useAppStore.getState();
  if (!doc || !editing || !dirty) return true;
  const choice = await askToSave(doc.title);
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  return saveEdits();
}

/**
 * ⌘S. One save at a time: a second press while the first is still writing
 * gets the first one's answer rather than writing the same text twice — or
 * worse, being told the file changed on disk by its own first write.
 */
export function saveEdits(): Promise<boolean> {
  saving ??= save().finally(() => {
    saving = null;
  });
  return saving;
}

async function save(): Promise<boolean> {
  const { doc, editing, setError } = useAppStore.getState();
  const editor = live;
  if (!doc || !editing || !editor) return false;

  // Taken now: whatever is typed while the write is under way is not in it,
  // and stays unsaved.
  const text = editor.text();
  const content = joinFromEditor(text, editor.meta);
  let modifiedAt: number | undefined;
  try {
    let outcome = await writeDocFile(doc.source, content, doc.modifiedAt);
    if (outcome.kind === 'conflict') {
      if (!(await askToOverwrite(doc.title))) return false;
      outcome = await writeDocFile(doc.source, content, undefined);
    }
    if (outcome.kind !== 'saved') return false;
    modifiedAt = outcome.modifiedAt;
  } catch (e) {
    setError(`Could not save: ${e}`);
    return false;
  }

  // Written either way; but a document opened in its place meanwhile is not
  // the one whose text this is.
  if (useAppStore.getState().doc?.id !== doc.id) return true;
  useAppStore.getState().applySave({ content, contentHash: annotationContentHash(content, doc.format), modifiedAt });
  editor.markSaved(text);
  // The recents entry previews the text, so it should preview this text.
  recordOpen({
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    source: doc.source,
    body: null,
    snippet: makeSnippet(content),
    charCount: countChars(content),
    openedAt: Date.now(),
  }).catch((e) => setError(`Saved, but could not update Recent: ${e}`));
  return true;
}

/**
 * Move the annotations onto the text just saved. `text` is the rendered text
 * of the new content, in the annotator's terms (see `collectAnnotatableText`);
 * the reader calls this once it has rendered it.
 *
 * Store first, then the database — the reader is waiting on the store to turn
 * the annotator back on, and a database failure is worth a line, not a stall.
 */
export function rebaseAfterSave(text: string): void {
  const { doc, annotations, rebaseAnnotations: settle, setError } = useAppStore.getState();
  if (!doc) return;
  const { kept, lost } = reanchorAnnotations(annotations, text);
  settle(kept, doc.contentHash);
  if (kept.length > 0 || lost.length > 0) {
    rebaseAnnotations(
      doc.id,
      doc.contentHash,
      kept,
      lost.map((a) => a.id),
    ).catch((e) => setError(`Could not update the annotations: ${e}`));
  }
  if (lost.length === 1) {
    setError('1 annotation could not be found after saving and was removed');
  } else if (lost.length > 1) {
    setError(`${lost.length} annotations could not be found after saving and were removed`);
  }
}

/**
 * ⌘S, wherever the focus is — the editor has no binding of its own for it, so
 * the key reaches the document whether it was pressed in the editor or not.
 * Off while the reader is covered: saving from the settings page would be
 * saving something the user cannot see.
 */
export function useSaveShortcut(enabled: boolean): void {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      saveEdits().catch(() => {});
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
