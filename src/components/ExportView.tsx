import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy } from 'lucide-react';
import { annotationsToMarkdown } from '../lib/annotations';
import { writeClipboardText } from '../lib/clipboard';
import { renderTemplate } from '../lib/template';
import { useAppStore } from '../store';

export function ExportView() {
  const source = useAppStore((s) => s.doc?.source ?? '');
  const annotations = useAppStore((s) => s.annotations);
  const template = useAppStore((s) => s.settings.template);
  const annotationTemplate = useAppStore((s) => s.settings.annotationTemplate);
  const setView = useAppStore((s) => s.setView);
  const [copied, setCopied] = useState(false);

  const output = useMemo(
    () =>
      renderTemplate(template, {
        filePath: source,
        annotations: annotationsToMarkdown(annotations, annotationTemplate),
      }),
    [template, annotationTemplate, source, annotations],
  );

  const copy = async () => {
    await writeClipboardText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5">
        <button
          className="flex items-center gap-1 rounded px-2 py-1 text-[13px] text-neutral-600 hover:bg-neutral-100"
          onClick={() => setView('reader')}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <h2 className="text-[13px] font-medium text-neutral-800">
          Exported Annotations
          <span className="ml-1.5 text-neutral-400">({annotations.length})</span>
        </h2>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1.5 rounded bg-amber-500 px-2.5 py-1 text-[13px] font-medium text-white hover:bg-amber-600"
          onClick={copy}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <textarea
        readOnly
        value={output}
        className="min-h-0 flex-1 resize-none bg-page p-4 font-mono text-[13px] leading-relaxed text-neutral-800 outline-none"
      />
    </div>
  );
}
