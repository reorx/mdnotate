import { useState, type FormEvent } from 'react';
import { homeDir } from '@tauri-apps/api/path';
import { FolderOpen } from 'lucide-react';
import { openFileDialog, openFilePath } from '../lib/open-doc';
import { expandHome, normalizePathInput, pathInputError } from '../lib/path-input';
import { isTauri } from '../lib/tauri-env';
import { ActionCard, CardButton, CardNote } from './ActionCard';

/**
 * The two ways to reach a file on disk: the system dialog, and a path pasted
 * straight in — from a terminal, from Finder's "Copy as Pathname", or typed by
 * hand. Whatever shape the path arrives in is untangled by `path-input`.
 */
export function OpenFileCard() {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    let resolved = normalizePathInput(path);
    // Where home is has to be asked for, so only ask when there is a ~ to expand.
    if (resolved.startsWith('~') && isTauri) resolved = expandHome(resolved, await homeDir());
    const problem = pathInputError(resolved);
    if (problem) {
      setError(problem);
      return;
    }
    await openFilePath(resolved);
    setPath('');
  };

  return (
    <ActionCard
      icon={<FolderOpen className="h-4 w-4 shrink-0 text-neutral-400" />}
      label="Read a Markdown file from disk"
      action={<CardButton onClick={() => openFileDialog().catch((e) => setError(String(e)))}>Open File…</CardButton>}
    >
      <form
        className="mt-1.5 flex items-center gap-1.5 pl-6"
        onSubmit={(e) => void submit(e).catch((err) => setError(String(err)))}
      >
        <input
          className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-[12px] text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="…or paste an absolute path"
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
