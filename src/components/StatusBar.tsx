import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { writeClipboardText } from '../lib/clipboard';
import { docStats } from '../lib/doc-info';
import type { DocFormat } from '../lib/doc-locator';

interface StatusBarProps {
  content: string;
  format: DocFormat;
  /** Whether the document is currently shown as its own source text. */
  showingSource: boolean;
  onToggleSource: () => void;
}

/**
 * The strip under the prose: how much document there is, and the two things one
 * does with the text rather than to it — take a copy of it, or look at what it
 * was written as.
 *
 * It belongs to the middle column alone, between the two panel dividers, and
 * sits outside the scroller so it stays put while the document moves.
 */
export function StatusBar({ content, format, showingSource, onToggleSource }: StatusBarProps) {
  // Measuring an eight-megabyte document walks all of it, twice. Once per
  // document is fine; once per render would not be.
  const stats = useMemo(() => docStats(content), [content]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await writeClipboardText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sourceLabel = format === 'markdown' ? 'Markdown source' : 'source text';

  return (
    <div className="flex h-6 shrink-0 items-center gap-2 border-t border-neutral-200 px-3 text-[11px] text-neutral-500">
      <span className="shrink-0 tabular-nums">
        {stats.chars} chars · {stats.size}
      </span>
      <div className="flex-1" />
      {/* Said out loud, because the two panels going quiet is otherwise the
          only sign of it — and looks like something broken. `min-w-0` so a
          narrow window clips this line rather than pushing the buttons out. */}
      {showingSource && <span className="min-w-0 truncate text-neutral-400">Annotations are off in source view</span>}
      <StatusButton label={copied ? 'Copied' : `Copy ${sourceLabel}`} onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </StatusButton>
      {/* Plain text is already its own source; there is no second view of it to
          switch to. */}
      {format === 'markdown' && (
        <StatusButton
          label={showingSource ? 'Back to the rendered document' : 'View Markdown source'}
          // Lit while it is on: this is the one button here that leaves the
          // reader in a different state than it found it.
          className={showingSource ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : undefined}
          onClick={onToggleSource}
        >
          {showingSource ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </StatusButton>
      )}
    </div>
  );
}

/** An icon and nothing else, so the name it carries is the only name it has. */
function StatusButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`shrink-0 rounded p-0.5 ${className ?? 'hover:bg-neutral-100 hover:text-neutral-800'}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
