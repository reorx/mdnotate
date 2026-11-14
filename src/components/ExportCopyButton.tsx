import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { writeClipboardText } from '../lib/clipboard';
import { exportUnavailableReason, renderExport } from '../lib/export-annotations';
import { useAppStore } from '../store';

/**
 * The header's export: one click renders the annotations through the export
 * templates and puts the result on the clipboard, without a stop on the Export
 * page. The page is still there, behind the annotation panel's own Export, for
 * when the result wants looking at first.
 *
 * Greyed rather than hidden while editing, so the Edit / View button beside it
 * does not shift: the annotations are about the saved text, and may yet move
 * when it is saved again.
 */
export function ExportCopyButton() {
  const source = useAppStore((s) => s.doc?.source ?? '');
  const annotations = useAppStore((s) => s.annotations);
  const settings = useAppStore((s) => s.settings);
  const editing = useAppStore((s) => s.editing);
  const setError = useAppStore((s) => s.setError);
  const [copied, setCopied] = useState(false);

  const disabledReason = exportUnavailableReason({ count: annotations.length, editing });

  const copy = async () => {
    await writeClipboardText(renderExport(source, annotations, settings));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      className="flex items-center gap-1.5 rounded bg-amber-500 px-2.5 py-1 text-[13px] font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40 dark:disabled:opacity-25"
      disabled={!!disabledReason}
      title={disabledReason ?? 'Export annotations with the template and copy them to the clipboard'}
      onClick={() => copy().catch((e) => setError(String(e)))}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {/* Both labels share one grid cell and the hidden one keeps its room,
          so the button is as wide saying "Copied" as before — a narrower one
          would pull the Edit button beside it to the right. */}
      <span className="grid">
        <span className={`col-start-1 row-start-1 ${copied ? 'invisible' : ''}`} aria-hidden={copied}>
          Export and Copy
        </span>
        <span className={`col-start-1 row-start-1 text-center ${copied ? '' : 'invisible'}`} aria-hidden={!copied}>
          Copied
        </span>
      </span>
      {annotations.length > 0 && <span className="rounded bg-amber-600 px-1 text-[11px]">{annotations.length}</span>}
    </button>
  );
}
