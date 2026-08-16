import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { writeClipboardText } from '../lib/clipboard';
import { docInfo } from '../lib/doc-info';
import { isCancelEscape } from '../lib/keys';
import type { OpenDoc } from '../lib/recent-docs';

/**
 * The document's name in the middle of the title bar, and what it opens: a
 * panel naming where the text came from and what is known about it.
 *
 * The name is a button rather than the label it used to be, which costs it its
 * `data-tauri-drag-region`: a mousedown on that attribute starts a window drag
 * (see `lib/window-drag.ts`), and a title that both dragged the window and
 * opened a panel would do neither well. Everything around it still drags, since
 * the wrapper takes no pointer events and the header behind it carries the
 * attribute.
 */
export function DocTitle({ doc }: { doc: OpenDoc }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // A panel describing one document should not outlive it.
  useEffect(() => setOpen(false), [doc.id]);

  // Both the button and the panel are inside `rootRef`, so clicking the button
  // to close is a click inside — the toggle below gets it, undisturbed.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    // On the document, so it fires wherever the focus is — including a box
    // somebody is composing in, where Escape only means "drop that candidate".
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCancelEscape(event)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    // Centred on the window rather than on the space left by the two button
    // groups, which are not the same width; `pointer-events-none` on the
    // wrapper keeps the gaps around it draggable.
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div ref={rootRef} className="pointer-events-auto relative max-w-[45%]">
        <button
          className="block max-w-full truncate rounded px-1.5 py-0.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-100"
          title={doc.source}
          aria-expanded={open}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          {doc.title}
        </button>
        {open && <DocInfoPanel doc={doc} />}
      </div>
    </div>
  );
}

function DocInfoPanel({ doc }: { doc: OpenDoc }) {
  // Sizing an eight-megabyte document means encoding it, so it waits until
  // there is someone to read the answer.
  const info = useMemo(() => docInfo(doc), [doc]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await writeClipboardText(info.source);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="absolute top-full left-1/2 z-30 mt-1.5 w-[320px] max-w-[80vw] -translate-x-1/2 rounded-md border border-neutral-200 bg-raised p-2.5 shadow-lg">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-neutral-400">{info.sourceLabel}</div>
          {/* Paths break anywhere: they have no spaces to wrap at, and one long
              enough to need three lines is still worth reading in full. */}
          <div className="mt-0.5 font-mono text-[11px] leading-snug break-all text-neutral-700">{info.source}</div>
        </div>
        <button
          className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          title={copied ? 'Copied' : `Copy ${info.sourceLabel.toLowerCase()}`}
          onClick={copy}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <dl className="mt-2 space-y-1 border-t border-neutral-200 pt-2 text-[12px]">
        {info.fields.map((field) => (
          <div key={field.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-neutral-500">{field.label}</dt>
            <dd className="tabular-nums text-neutral-700">{field.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
