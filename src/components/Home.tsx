import { FolderOpen } from 'lucide-react';
import { openFileDialog } from '../lib/open-doc';
import { fileDocId } from '../lib/recent-docs';
import { SAMPLE_DOC, SAMPLE_DOC_PATH } from '../lib/sample-doc';
import { isTauri } from '../lib/tauri-env';
import { useAppStore } from '../store';
import { ActionCard, CardButton } from './ActionCard';
import { ClipboardCard } from './ClipboardCard';
import { DefaultAppCard } from './DefaultAppCard';
import { RecentList } from './RecentList';

/**
 * Landing screen: the two ways into a document — a file on disk or whatever is
 * on the clipboard — followed by everything opened lately.
 */
export function Home() {
  const setError = useAppStore((s) => s.setError);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[36rem] flex-col gap-3 px-8 py-8">
        <ActionCard
          icon={<FolderOpen className="h-4 w-4 shrink-0 text-neutral-400" />}
          label="Read a Markdown file from disk"
          action={
            <CardButton onClick={() => openFileDialog().catch((e) => setError(String(e)))}>Open File…</CardButton>
          }
        />

        <ClipboardCard />
        <RecentList />
        <DefaultAppCard />

        {import.meta.env.DEV && !isTauri && (
          <button
            className="self-start px-2 text-[12px] text-neutral-400 underline"
            onClick={() =>
              useAppStore.getState().openDoc({
                id: fileDocId(SAMPLE_DOC_PATH),
                kind: 'file',
                title: 'sample-document.md',
                source: SAMPLE_DOC_PATH,
                content: SAMPLE_DOC,
              })
            }
          >
            Open the sample document
          </button>
        )}
      </div>
    </div>
  );
}
