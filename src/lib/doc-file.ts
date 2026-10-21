import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauri-env';

/**
 * Writing a document back to the file it was read from.
 *
 * `expectedModified` is when the file was last written as far as we know — at
 * the open, or at our own last save. If the file on disk says otherwise,
 * something else has written it since, and saving over it would throw that
 * away unseen; nothing is written and the answer is a conflict, for the caller
 * to ask about. Leaving it out writes regardless.
 *
 * A conflict is an answer, not a failure. A write that fails — no permission,
 * a full disk — rejects with the reason.
 */

export type WriteOutcome = { kind: 'saved'; modifiedAt?: number } | { kind: 'conflict' };

export async function writeDocFile(path: string, content: string, expectedModified?: number): Promise<WriteOutcome> {
  // Plain-browser dev has no disk to write to; pretend, so the whole editing
  // flow can still be walked through there.
  if (!isTauri) return { kind: 'saved', modifiedAt: Date.now() };
  const outcome = await invoke<{ kind: 'saved'; modified: number | null } | { kind: 'conflict' }>('write_local_file', {
    path,
    content,
    expectedModified: expectedModified ?? null,
  });
  return outcome.kind === 'saved' ? { kind: 'saved', modifiedAt: outcome.modified ?? undefined } : outcome;
}
