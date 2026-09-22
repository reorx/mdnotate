import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { openFileDialog } from '../lib/open-doc';
import { ActionCard, CardButton, CardNote } from './ActionCard';
import { PathEntry } from './PathEntry';

/**
 * The ways to reach a document that is not on the clipboard: the system dialog,
 * and — in `PathEntry`, which the ⌘O panel shows as well — a path typed or
 * pasted in, whole or in two halves.
 */
export function OpenFileCard() {
  const [error, setError] = useState<string | null>(null);

  return (
    <ActionCard
      icon={<FolderOpen className="h-4 w-4 shrink-0 text-neutral-400" />}
      label="Read a document from disk or another machine"
      action={<CardButton onClick={() => openFileDialog().catch((e) => setError(String(e)))}>Open File…</CardButton>}
    >
      <PathEntry indent />
      {error && <CardNote tone="error">{error}</CardNote>}
    </ActionCard>
  );
}
