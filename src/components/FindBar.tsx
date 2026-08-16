import type { RefObject } from 'react';
import { ChevronDown, ChevronUp, TriangleAlert, X } from 'lucide-react';
import { isImeComposing } from '../lib/keys';
import { matchLabel } from '../lib/search';

interface FindBarProps {
  query: string;
  count: number;
  active: number;
  capped: boolean;
  /** False on a system too old for the CSS Custom Highlight API. */
  paints: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onComposingChange: (composing: boolean) => void;
  onStep: (delta: number) => void;
  onClose: () => void;
}

const BUTTON =
  'rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:disabled:opacity-25';

/**
 * Find in document. Floats over the prose in the top right, out of the way of
 * the text but not of the scrollbar — inside the scroller it would slide off
 * the moment a match was jumped to.
 */
export function FindBar({
  query,
  count,
  active,
  capped,
  paints,
  inputRef,
  onQueryChange,
  onComposingChange,
  onStep,
  onClose,
}: FindBarProps) {
  const missing = query !== '' && count === 0;

  return (
    <div className="absolute top-3 right-4 z-30 flex items-center gap-0.5 rounded-md border border-neutral-200 bg-raised px-1.5 py-1 shadow-lg">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        // An IME's half-formed syllables are not worth searching for; the
        // query is only run once the composition settles.
        onCompositionStart={() => onComposingChange(true)}
        onCompositionEnd={() => onComposingChange(false)}
        // Not `isSubmitEnter`: Shift+Enter is a direction here, not a newline.
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || isImeComposing(e)) return;
          e.preventDefault();
          onStep(e.shiftKey ? -1 : 1);
        }}
        placeholder="Find in document"
        spellCheck={false}
        className={`w-48 bg-transparent px-1 text-[13px] outline-none placeholder:text-neutral-400 ${
          missing ? 'text-red-600' : 'text-neutral-800'
        }`}
      />
      {/* Nothing typed, nothing to count — the same as every other find bar. */}
      {query !== '' && (
        <span className={`shrink-0 px-1 text-[12px] tabular-nums ${missing ? 'text-red-600' : 'text-neutral-400'}`}>
          {matchLabel(count, active, capped)}
        </span>
      )}
      {!paints && (
        <span title="This system is too old to colour the matches (needs macOS 14.2); the count and the jumps still work.">
          <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
        </span>
      )}
      <div className="mx-0.5 h-4 w-px shrink-0 bg-neutral-200" />
      {/* The pointer must not take the focus off the box: a click on ∧ or ∨ is
          usually followed by more typing. */}
      <button
        className={BUTTON}
        disabled={count === 0}
        title="Previous match (⇧⏎)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onStep(-1)}
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        className={BUTTON}
        disabled={count === 0}
        title="Next match (⏎)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onStep(1)}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button className={BUTTON} title="Close (Esc)" onClick={onClose}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
