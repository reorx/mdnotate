import { useEffect, useRef, useState, type CSSProperties } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import type { DocFormat } from '../lib/doc-locator';
import { saveSettings, type Settings } from '../lib/settings';
import { DEFAULT_TEMPLATE } from '../lib/template';
import type { ThemePreference } from '../lib/theme';
import {
  clampTypography,
  DEFAULT_TYPOGRAPHY,
  FONT_SIZE,
  formatWidth,
  LINE_HEIGHT,
  sliderFromWidth,
  typographyVars,
  WIDTH,
  widthFromSlider,
  type Typography,
} from '../lib/typography';
import { useAppStore } from '../store';

/** How long after the last drag the sliders reach the disk. */
const SAVE_DELAY = 200;

const TABS: SegmentedOption<DocFormat>[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Plain text' },
];

const THEMES: SegmentedOption<ThemePreference>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const PREVIEW_MARKDOWN = `### A heading to size against

The quick brown fox jumps over the lazy dog. 敏捷的棕色狐狸跳过了懒狗，顺手把 \`inline code\` 一起带上了。

> And a quote, so the spacing between blocks is visible too.
`;

const PREVIEW_TEXT = `2026-08-11 22:04:11  INFO   started, reading config
2026-08-11 22:04:11  DEBUG  { "retries": 3, "timeout": "10s" }
2026-08-11 22:04:12  WARN   slow response from upstream`;

export function SettingsView() {
  const template = useAppStore((s) => s.settings.template);
  const typography = useAppStore((s) => s.settings.typography);
  const theme = useAppStore((s) => s.settings.theme);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const docFormat = useAppStore((s) => s.doc?.format ?? null);
  const setView = useAppStore((s) => s.setView);
  const [draft, setDraft] = useState(template);
  const [saved, setSaved] = useState(false);
  // Opened from a document, the tab worth landing on is the one that document
  // is rendered with. The view is unmounted when hidden, so this re-picks on
  // every visit rather than remembering a tab from another document.
  const [tab, setTab] = useState<DocFormat>(docFormat ?? 'markdown');

  const pending = useRef<Partial<Settings> | null>(null);
  const timer = useRef<number | null>(null);

  const flush = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = null;
    if (patch) saveSettings(patch).catch(() => {});
  };

  // Closing settings flushes whatever the debounce is still holding: the last
  // nudge before hitting Back must not be the one that gets dropped.
  useEffect(() => flush, []);

  const scheduleSave = (patch: Partial<Settings>) => {
    pending.current = { ...pending.current, ...patch };
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY);
  };

  // No debounce: a theme is picked, not dragged, and the whole window changes
  // the moment it lands — a write that arrives 200ms later would be the only
  // part of it that lags.
  const applyTheme = (value: ThemePreference) => {
    updateSettings({ theme: value });
    saveSettings({ theme: value }).catch(() => {});
  };

  const saveTemplate = async (value: string) => {
    updateSettings({ template: value });
    await saveSettings({ template: value });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const current = typography[tab];

  // Slider values arrive as raw floats — the same clamp that guards the stored
  // settings also keeps 1.7500000000000002 out of the stylesheet.
  const applyTypography = (next: Typography) => {
    const patch = { typography: { ...typography, [tab]: clampTypography(next, current) } };
    updateSettings(patch);
    scheduleSave(patch);
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
        <h3 className="mb-1 text-[13px] font-medium text-neutral-800">Appearance</h3>
        <p className="mb-2.5 text-[12px] leading-snug text-neutral-500">
          Light, dark, or whichever the system is on
          {theme === 'system' && <> — right now that is {resolvedTheme}</>}.
        </p>
        <Segmented options={THEMES} value={theme} onChange={applyTheme} />

        <div className="mt-7 border-t border-neutral-200 pt-5" />

        <h3 className="mb-1 text-[13px] font-medium text-neutral-800">Typography</h3>
        <p className="mb-2.5 text-[12px] leading-snug text-neutral-500">
          How the reading pane is set. Markdown and plain text keep their own sizes — a log is not read the way prose
          is.
        </p>

        <Segmented options={TABS} value={tab} onChange={setTab} className="mb-3" />

        <div className="flex flex-col gap-2">
          <Slider
            label="Font size"
            min={FONT_SIZE.min}
            max={FONT_SIZE.max}
            step={FONT_SIZE.step}
            value={current.fontSize}
            display={`${current.fontSize} px`}
            onChange={(fontSize) => applyTypography({ ...current, fontSize })}
          />
          <Slider
            label="Line height"
            min={LINE_HEIGHT.min}
            max={LINE_HEIGHT.max}
            step={LINE_HEIGHT.step}
            value={current.lineHeight}
            display={current.lineHeight.toFixed(2)}
            onChange={(lineHeight) => applyTypography({ ...current, lineHeight })}
          />
          {/* One step past the last rem value is full width — see widthFromSlider. */}
          <Slider
            label="Content width"
            min={WIDTH.min}
            max={WIDTH.max + WIDTH.step}
            step={WIDTH.step}
            value={sliderFromWidth(current.width)}
            display={formatWidth(current.width)}
            onChange={(position) => applyTypography({ ...current, width: widthFromSlider(position) })}
          />
        </div>

        <TypographyPreview format={tab} typography={current} />

        <div className="mt-2">
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-[13px] text-neutral-500 hover:bg-neutral-100"
            onClick={() => applyTypography(DEFAULT_TYPOGRAPHY[tab])}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </button>
        </div>

        <div className="mt-7 border-t border-neutral-200 pt-5">
          <label className="mb-1 block text-[13px] font-medium text-neutral-800">Export template</label>
          <p className="mb-2 text-[12px] leading-snug text-neutral-500">
            Placeholders: <code className="rounded bg-neutral-100 px-1">{'{{filePath}}'}</code> — the path of the opened
            file, or the title of a clipboard entry;{' '}
            <code className="rounded bg-neutral-100 px-1">{'{{annotations}}'}</code> — the highlights as blockquotes,
            each followed by its comment.
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
              onClick={() => saveTemplate(draft)}
            >
              Save
            </button>
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-[13px] text-neutral-500 hover:bg-neutral-100"
              onClick={() => {
                setDraft(DEFAULT_TEMPLATE);
                saveTemplate(DEFAULT_TEMPLATE);
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to default
            </button>
            {saved && <span className="text-[12px] text-green-600">Saved</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** A row of mutually exclusive choices, small enough to sit inline with prose. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex gap-0.5 rounded bg-neutral-100 p-0.5 ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          className={`rounded px-2.5 py-1 text-[12px] ${
            value === option.value
              ? 'bg-raised font-medium text-neutral-800 shadow-sm'
              : 'text-neutral-500 hover:text-neutral-700'
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-[12px] text-neutral-600">{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
        className="h-4 min-w-0 flex-1 cursor-pointer accent-amber-500"
      />
      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-neutral-500">{display}</span>
    </div>
  );
}

/**
 * The settings view covers the reader, so the sliders would otherwise be dragged
 * blind. Same custom properties, same prose classes — what happens here is what
 * happens to the document.
 */
function TypographyPreview({ format, typography }: { format: DocFormat; typography: Typography }) {
  return (
    <div
      className="mt-3 overflow-hidden rounded border border-neutral-200"
      style={typographyVars(typography) as CSSProperties}
    >
      <div className="prose-column mx-auto px-4 py-3">
        {format === 'markdown' ? (
          <article className="prose-dense">
            <ReactMarkdown>{PREVIEW_MARKDOWN}</ReactMarkdown>
          </article>
        ) : (
          <article className="prose-plain">{PREVIEW_TEXT}</article>
        )}
      </div>
    </div>
  );
}
