import { openSampleDoc } from '../lib/open-doc';
import { isTauri } from '../lib/tauri-env';
import { CliInstallCard } from './CliInstallCard';
import { ClipboardCard } from './ClipboardCard';
import { DefaultAppCard } from './DefaultAppCard';
import { OpenFileCard } from './OpenFileCard';
import { RecentList } from './RecentList';

/**
 * Landing screen: the two ways into a document — a file on disk or whatever is
 * on the clipboard — followed by everything opened lately.
 */
export function Home() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Wide enough for the prefix and suffix boxes to sit side by side and
          still each show a path's worth of text. */}
      <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-3 px-8 py-8">
        <OpenFileCard />
        <ClipboardCard />
        <RecentList />
        <DefaultAppCard />
        <CliInstallCard />

        {import.meta.env.DEV && !isTauri && (
          <button className="self-start px-2 text-[12px] text-neutral-400 underline" onClick={() => openSampleDoc()}>
            Open the sample document
          </button>
        )}
      </div>
    </div>
  );
}
