import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { isImeComposing } from '../lib/keys';
import { matchPrefixes } from '../lib/path-prefix';
import { CARD_INPUT } from './ActionCard';

interface PrefixComboboxProps {
  value: string;
  /** Every prefix remembered, most recently used first. */
  prefixes: string[];
  onChange: (value: string) => void;
  /** A prefix was settled on; what follows it is the next thing to type. */
  onCommit: () => void;
  onForget: (prefix: string) => void;
}

/**
 * The leading half of a path, completed from the ones used before.
 *
 * The list opens on focus rather than only on typing: with the box empty it is
 * the shortest way back to yesterday's directory, which is where the next
 * document usually is. Enter settles on a suggestion and moves on — it never
 * opens anything, since the file name has still to be typed.
 */
export function PrefixCombobox({ value, prefixes, onChange, onCommit, onForget }: PrefixComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  // Which suggestion the arrow keys are on; -1 while none has been reached,
  // when Enter still takes the first one.
  const [active, setActive] = useState(-1);

  const suggestions = useMemo(() => matchPrefixes(prefixes, value), [prefixes, value]);
  const shown = open && suggestions.length > 0;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const choose = (prefix: string) => {
    onChange(prefix);
    close();
    onCommit();
  };

  /** Wraps at both ends, and arrives at whichever end it was heading for. */
  const step = (delta: number) => {
    const count = suggestions.length;
    if (count === 0) return;
    setActive((current) => {
      if (current < 0) return delta > 0 ? 0 : count - 1;
      return (current + delta + count) % count;
    });
  };

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // An IME's half-formed syllables belong to the composition, not to us —
    // and the arrows below are the candidate list's before they are the
    // suggestion list's.
    if (isImeComposing(e)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      else step(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Nothing matching is not a reason to stop: what was typed is a prefix
      // too, it is simply one that has not been used before. Falling back on
      // the first also covers an index the list has since shrunk out from
      // under — forgetting the entry the cursor was on does exactly that.
      if (shown) onChange(suggestions[active] ?? suggestions[0]);
      close();
      onCommit();
      return;
    }
    // Only ours to swallow while the list is up; otherwise it belongs to
    // whoever else is listening for it.
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div
      className="relative min-w-0 flex-[3]"
      // Tab leaves for the suffix box, and the list has no business following.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) close();
      }}
    >
      <input
        className={`${CARD_INPUT} w-full`}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={keyDown}
        placeholder="~/Sync/notes"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      {shown && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-20 mt-1 rounded-md border border-neutral-200 bg-raised p-1 shadow-lg"
        >
          {suggestions.map((prefix, i) => (
            <li key={prefix} className="group relative">
              <button
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                type="button"
                tabIndex={-1}
                className={`block w-full truncate rounded px-2 py-1 pr-7 text-left text-[12px] ${
                  i === active ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-700 hover:bg-neutral-100'
                }`}
                // The pointer must not take the focus out of the box: the next
                // thing to happen is more typing, in the box next to it.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(prefix)}
              >
                {prefix}
              </button>
              <button
                type="button"
                tabIndex={-1}
                title="Forget this prefix"
                aria-label={`Forget ${prefix}`}
                className={`absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 ${
                  i === active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setActive(-1);
                  onForget(prefix);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
