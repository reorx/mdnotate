import { useState, type FormEvent } from 'react';
import { FolderOpen } from 'lucide-react';
import { openFileDialog, openSpec } from '../lib/open-doc';
import { normalizePathInput } from '../lib/path-input';
import { ActionCard, CardButton, CardNote } from './ActionCard';

/**
 * The ways to reach a document that is not on the clipboard: the system dialog,
 * and a path pasted straight in — from a terminal, from Finder's "Copy as
 * Pathname", or typed by hand. `path-input` untangles whatever shape it arrives
 * in; `doc-locator` decides what it names, which may be a file on another
 * machine (`maiev.ts:Sync/a.md`) or an mdnotate link.
 */
export function OpenFileCard() {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    await openSpec(normalizePathInput(path));
    setPath('');
  };

  return (
    <ActionCard
      icon={<FolderOpen className="h-4 w-4 shrink-0 text-neutral-400" />}
      label="Read a document from disk or another machine"
      action={<CardButton onClick={() => openFileDialog().catch((e) => setError(String(e)))}>Open File…</CardButton>}
    >
      <form
        className="mt-1.5 flex items-center gap-1.5 pl-6"
        onSubmit={(e) => void submit(e).catch((err) => setError(String(err)))}
      >
        <input
          className="min-w-0 flex-1 rounded border border-neutral-300 bg-page px-2 py-1 text-[12px] text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="…or paste /a/path or host:path"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <CardButton variant="secondary" type="submit" disabled={!path.trim()}>
          Open
        </CardButton>
      </form>
      {error && <CardNote tone="error">{error}</CardNote>}
    </ActionCard>
  );
}
