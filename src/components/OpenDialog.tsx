import { useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { FileDown, X } from 'lucide-react';
import { isCancelEscape } from '../lib/keys';
import { openFileDialog } from '../lib/open-doc';
import { isTauri } from '../lib/tauri-env';
import { useAppStore } from '../store';
import { ClipboardCard } from './ClipboardCard';
import { PathEntry } from './PathEntry';
import { RecentList } from './RecentList';

/**
 * What ⌘O puts up: a compact home screen, laid over whatever was on screen.
 *
 * Deliberately not the system file dialog. The paths this reader is pointed at
 * are mostly pasted, or built from a directory it already remembers, and a file
 * dialog reaches neither those nor a file on another machine. It is still here,
 * one click into the drop zone, for the times a document has to be found by
 * looking.
 *
 * Nothing in here closes the panel on a successful open. `openDoc` does, for
 * every way in at once — see the store.
 */
export function OpenDialog() {
  const close = useAppStore((s) => s.setOpenDialog);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    // Bubble, not capture: `PrefixCombobox` stops an Escape that only closes
    // its suggestion list, and taking the key first would close the panel out
    // from under a list the user was only dismissing.
    const onKey = (e: KeyboardEvent) => {
      if (!isCancelEscape(e)) return;
      e.preventDefault();
      close(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // Lighting up the drop zone, and nothing else. The file is opened by Rust's
  // own window drag-drop handler long before this sees it — opening it here as
  // well would open it twice. Dropping anywhere on the window works exactly as
  // it did before; this only says so.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        setOver(event.payload.type === 'enter' || event.payload.type === 'over');
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div
      // `black`, not `neutral-900`: the neutral ramp is inverted wholesale in
      // dark mode, where 900 is nearly white — a scrim has to be dark in both.
      className="fixed inset-0 z-40 flex justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div className="mt-[12vh] flex max-h-[76vh] w-[40rem] max-w-[calc(100vw-4rem)] flex-col overflow-y-auto rounded-lg border border-neutral-200 bg-page p-4 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-[13px] font-medium tracking-wide text-neutral-500 uppercase">Open a document</h2>
          {/* An icon and nothing else, so the name it carries is its only name. */}
          <button
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            title="Close"
            aria-label="Close"
            onClick={() => close(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <button
          className={`flex flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 ${
            over ? 'border-amber-400 bg-amber-50' : 'border-neutral-300 hover:bg-neutral-50'
          }`}
          onClick={() => openFileDialog().catch((e) => setError(String(e)))}
        >
          <FileDown className={`h-5 w-5 ${over ? 'text-amber-500' : 'text-neutral-400'}`} />
          <span className="text-[13px] text-neutral-600">
            Drop a file here <span className="text-neutral-400">· or click to browse…</span>
          </span>
        </button>

        <PathEntry autoFocus />

        {error && <p className="mt-1.5 text-[12px] leading-snug text-red-600">{error}</p>}

        <div className="mt-3 flex flex-col gap-3">
          <ClipboardCard />
          <RecentList />
        </div>
      </div>
    </div>
  );
}
