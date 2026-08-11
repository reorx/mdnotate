import { useEffect, useState } from 'react';
import { ClipboardPaste, FileText, Highlighter, X } from 'lucide-react';
import { countAnnotations } from '../lib/annotations-db';
import { openRecent } from '../lib/open-doc';
import { formatCharCount, formatRelativeTime, type RecentDoc } from '../lib/recent-docs';
import { clearRecents, deleteRecent, listRecents } from '../lib/recents-db';
import { useAppStore } from '../store';

/**
 * Recently opened documents — files and clipboard entries in one list, newest
 * first. Files are checked lazily: rather than stat-ing every path on load, a
 * file that fails to open is marked unavailable on the spot.
 */
export function RecentList() {
  const setError = useAppStore((s) => s.setError);
  const [docs, setDocs] = useState<RecentDoc[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [unavailable, setUnavailable] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([listRecents(), countAnnotations()])
      .then(([next, byDoc]) => {
        if (!alive) return;
        setDocs(next);
        setCounts(byDoc);
      })
      .catch((e) => setError(String(e)));
    return () => {
      alive = false;
    };
  }, [setError]);

  const open = (doc: RecentDoc) =>
    openRecent(doc).catch((e) => {
      setUnavailable((ids) => (ids.includes(doc.id) ? ids : [...ids, doc.id]));
      setError(String(e));
    });

  const remove = (id: string) =>
    deleteRecent(id)
      .then(() => setDocs((current) => current?.filter((d) => d.id !== id) ?? null))
      .catch((e) => setError(String(e)));

  const clear = () =>
    clearRecents()
      .then(() => setDocs([]))
      .catch((e) => setError(String(e)));

  if (!docs?.length) return null;
  const now = Date.now();

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center gap-2 px-2">
        <h2 className="text-[12px] font-medium tracking-wide text-neutral-500 uppercase">Recent</h2>
        <div className="flex-1" />
        <button className="text-[12px] text-neutral-400 hover:text-neutral-700" onClick={clear}>
          Clear All
        </button>
      </div>
      <ul>
        {docs.map((doc) => {
          const Icon = doc.kind === 'file' ? FileText : ClipboardPaste;
          const missing = unavailable.includes(doc.id);
          const count = counts[doc.id] ?? 0;
          const detail = doc.kind === 'file' ? doc.source : `${formatCharCount(doc.charCount)} chars · ${doc.snippet}`;
          return (
            <li key={doc.id} className="group relative">
              <button
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-100 ${
                  missing ? 'opacity-50' : ''
                }`}
                onClick={() => open(doc)}
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-[13px] font-medium text-neutral-800">{doc.title}</span>
                    {count > 0 && (
                      <span
                        className="flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 text-[11px] text-amber-700"
                        title={`${count} annotation${count > 1 ? 's' : ''}`}
                      >
                        <Highlighter className="h-2.5 w-2.5" />
                        {count}
                      </span>
                    )}
                    {missing && <span className="shrink-0 text-[11px] text-red-500">not found</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-neutral-500">{detail}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-[11px] text-neutral-400 group-hover:opacity-0">
                  {formatRelativeTime(doc.openedAt, now)}
                </span>
              </button>
              <button
                className="absolute top-1.5 right-1.5 rounded p-1 text-neutral-400 opacity-0 group-hover:opacity-100 hover:bg-neutral-200 hover:text-neutral-700"
                title="Remove from recent"
                onClick={() => remove(doc.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
