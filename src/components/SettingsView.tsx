import { useState } from 'react';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { saveTemplate } from '../lib/settings';
import { DEFAULT_TEMPLATE } from '../lib/template';
import { useAppStore } from '../store';

export function SettingsView() {
  const template = useAppStore((s) => s.template);
  const setTemplate = useAppStore((s) => s.setTemplate);
  const setView = useAppStore((s) => s.setView);
  const [draft, setDraft] = useState(template);
  const [saved, setSaved] = useState(false);

  const save = async (value: string) => {
    setTemplate(value);
    await saveTemplate(value);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
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
        <h2 className="text-[13px] font-medium text-neutral-800">Settings</h2>
      </div>
      <div className="mx-auto w-full max-w-[42rem] flex-1 overflow-y-auto px-6 py-5">
        <label className="mb-1 block text-[13px] font-medium text-neutral-800">Export template</label>
        <p className="mb-2 text-[12px] leading-snug text-neutral-500">
          Placeholders: <code className="rounded bg-neutral-100 px-1">{'{{filePath}}'}</code> — the path of the opened
          file, or the title of a clipboard entry;{' '}
          <code className="rounded bg-neutral-100 px-1">{'{{annotations}}'}</code> — the highlights as blockquotes, each
          followed by its comment.
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          spellCheck={false}
          className="w-full resize-y rounded border border-neutral-300 p-2.5 font-mono text-[13px] leading-relaxed outline-none focus:border-amber-500"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            className="rounded bg-amber-500 px-3 py-1 text-[13px] font-medium text-white hover:bg-amber-600"
            onClick={() => save(draft)}
          >
            Save
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-[13px] text-neutral-500 hover:bg-neutral-100"
            onClick={() => {
              setDraft(DEFAULT_TEMPLATE);
              save(DEFAULT_TEMPLATE);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </button>
          {saved && <span className="text-[12px] text-green-600">Saved</span>}
        </div>
      </div>
    </div>
  );
}
