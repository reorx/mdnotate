import { message } from '@tauri-apps/plugin-dialog';
import { isTauri } from './tauri-env';

/**
 * The two questions editing has to ask, in the system's own alerts.
 *
 * Native rather than drawn in the page: they can come up while the window is
 * closing or the app is quitting, which is exactly when the user expects the
 * sheet every Mac app shows, and a dialog of our own would have to be laid over
 * whatever view happens to be on top.
 */

export type SaveChoice = 'save' | 'discard' | 'cancel';

const SAVE = 'Save';
const DISCARD = "Don't Save";
const CANCEL = 'Cancel';

/**
 * What the alert's answer means. Depending on the dialog backend it comes back
 * as the standard button name or as the label we gave the button, so both are
 * read. Anything else — Escape, a dismissed sheet — is Cancel, the one answer
 * that loses nothing.
 */
export function saveChoiceOf(result: string): SaveChoice {
  if (result === 'Yes' || result === SAVE) return 'save';
  if (result === 'No' || result === DISCARD) return 'discard';
  return 'cancel';
}

/** Save / Don't Save / Cancel, about the document called `title`. */
export async function askToSave(title: string): Promise<SaveChoice> {
  const question = `Do you want to save the changes you made to “${title}”?`;
  if (!isTauri) {
    // Two yes/no questions stand in for three buttons in plain-browser dev.
    if (window.confirm(`${question}\n\nOK saves them.`)) return 'save';
    return window.confirm('Discard the changes?') ? 'discard' : 'cancel';
  }
  const result = await message(`${question}\n\nYour changes will be lost if you don't save them.`, {
    title: 'Unsaved changes',
    kind: 'warning',
    buttons: { yes: SAVE, no: DISCARD, cancel: CANCEL },
  });
  return saveChoiceOf(result);
}

/** Whether to write over a file something else has written since we read it. */
export async function askToOverwrite(title: string): Promise<boolean> {
  const question = `“${title}” has been changed on disk since it was opened. Overwrite it with your version?`;
  if (!isTauri) return window.confirm(question);
  const result = await message(question, {
    title: 'File changed on disk',
    kind: 'warning',
    buttons: { ok: 'Overwrite', cancel: CANCEL },
  });
  return result === 'Ok' || result === 'Overwrite';
}
