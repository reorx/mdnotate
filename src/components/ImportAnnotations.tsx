import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { importAnnotations } from '../lib/annotate';
import { prepareAnnotationImport, type AnnotationImportPreview, type ImportStatus } from '../lib/import-annotations';
import { isCancelEscape } from '../lib/keys';
import type { OpenDoc } from '../lib/recent-docs';
import { useAppStore } from '../store';

const STATUS_TEXT: Record<ImportStatus, string> = {
  ready: 'Ready to import', duplicate: 'Duplicate · skipped', missing: 'Original text not found',
  ambiguous: 'Multiple matches · position unknown', 'format-error': 'Format issue · check entry boundaries and quote prefixes',
};

/**
 * A reader-local overlay, outside annotatable prose. The covered reader stays
 * mounted and inert, preserving sidebar comment drafts and its live annotator.
 * Preview is an explicit step: changing even one input character invalidates it.
 */
export function ImportAnnotations({ doc, readText, onClose }: {
  doc: OpenDoc; readText: () => string | null; onClose: () => void;
}) {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<AnnotationImportPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    inputRef.current?.focus();
    return () => {
      mounted.current = false;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  const showPreview = () => {
    const text = readText();
    if (text === null) { setMessage('Return to the rendered document and try again.'); return; }
    setPreview(prepareAnnotationImport(doc, input, text, useAppStore.getState().annotations));
    setMessage(null);
  };
  const submit = async () => {
    if (!preview || submitting.current) return;
    submitting.current = true;
    setPending(true);
    try {
      const result = await importAnnotations(preview, readText);
      if (!mounted.current) return;
      if (result.status === 'imported' && result.failed === 0) { onClose(); return; }
      setPreview(null);
      setMessage(result.status === 'stale' ? 'This preview expired. Preview again on the current document.' :
        result.status === 'empty' ? 'No new annotations to import. Preview again to see duplicates.' :
        `${result.saved} saved; ${result.failed} could not be saved. Imported highlights are on this page. Export them before leaving to keep a copy.`);
    } catch (error) {
      if (mounted.current) setMessage(`Could not import annotations: ${error}`);
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const ready = preview?.rows.filter(row => row.status === 'ready').length ?? 0;
  return (
    <section aria-label="Import annotations" className="absolute inset-0 z-30 flex min-w-0 flex-col bg-page text-neutral-800"
      onKeyDown={event => { if (isCancelEscape(event)) { event.stopPropagation(); if (!pending) onClose(); } }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-1.5">
        <button disabled={pending} onClick={onClose} className="flex items-center gap-1 rounded px-2 py-1 text-[13px] text-neutral-600 hover:bg-neutral-100 disabled:opacity-50">
          <ArrowLeft className="h-3.5 w-3.5" /> {message ? 'Back' : 'Cancel'}
        </button>
        <h2 className="text-[13px] font-medium">Import annotations</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          <p className="text-[13px] leading-relaxed text-neutral-600">Import into <strong className="break-all font-medium text-neutral-800">{doc.title}</strong>. Paste an export made with the default Markdown template. Existing annotations stay in place.</p>
          <p className="text-[12px] leading-relaxed text-neutral-600">The path heading is ignored. Only exact, unique matches can be restored. Blank lines followed by a quote start a new entry; comments containing quotes may lose their original boundaries. Check every entry below.</p>
          <div>
            <label htmlFor="annotation-import-text" className="mb-1.5 block text-[13px] font-medium">Exported Markdown</label>
            <textarea id="annotation-import-text" ref={inputRef} value={input} disabled={pending} rows={7} spellCheck={false}
              placeholder={'# /path/to/document.md\n\n> Highlighted text\nOptional comment'}
              onChange={event => { setInput(event.target.value); setPreview(null); setMessage(null); }}
              className="block w-full resize-y rounded border border-neutral-300 bg-raised p-3 font-mono text-[13px] leading-relaxed text-neutral-800 placeholder:text-neutral-500 focus:border-amber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30" />
          </div>
          {message && <p role="alert" className="text-[13px] leading-relaxed text-neutral-800">{message}</p>}
          {preview && <div aria-live="polite">
            <h3 className="mb-2 text-[13px] font-medium">Preview · {ready} ready, {preview.rows.length - ready} skipped</h3>
            <ol className="divide-y divide-neutral-200 border-y border-neutral-200">
              {preview.rows.map(row => <li key={row.number} className="py-3">
                <p className={`mb-2 text-[12px] font-medium ${row.status === 'ready' ? 'text-neutral-800' : 'text-neutral-600'}`}>{row.number}. {STATUS_TEXT[row.status]}</p>
                <blockquote className="whitespace-pre-wrap break-words border-l border-neutral-300 pl-3 text-[13px] leading-relaxed">{row.quote || '(Empty quote)'}</blockquote>
                {row.comment !== null && <div className="mt-2 text-[13px] leading-relaxed text-neutral-600"><span className="text-[12px] font-medium">Comment</span><p className="whitespace-pre-wrap break-words">{row.comment}</p></div>}
              </li>)}
            </ol>
          </div>}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 px-4 py-2">
        <button disabled={!input.trim() || pending} onClick={showPreview} className="rounded border border-neutral-300 px-3 py-1.5 text-[13px] hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50">Preview</button>
        <button disabled={!ready || pending} onClick={submit} className="rounded bg-amber-500 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">{pending ? 'Importing…' : `Import${preview ? ` ${ready}` : ''}`}</button>
      </div>
    </section>
  );
}
