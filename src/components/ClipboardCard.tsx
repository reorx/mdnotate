import { useEffect, useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { readClipboardText } from '../lib/clipboard';
import { openClipboardText } from '../lib/open-doc';
import { describeClipboard } from '../lib/recent-docs';
import { ActionCard, CardButton, CardNote } from './ActionCard';

/**
 * "Open Clipboard" card: shows how much text is on the clipboard and how it
 * starts, so copied prose can be read here without saving it to a file first.
 *
 * There is no clipboard-changed event to subscribe to, so the content is read
 * on mount and again whenever the window regains focus — which is exactly when
 * the user has come back from copying something elsewhere.
 */
export function ClipboardCard() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = () => {
      readClipboardText()
        // A clipboard we are not allowed to read is, for our purposes, an empty one.
        .catch(() => null)
        .then((next) => {
          if (alive) setText(next);
        });
    };
    check();
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      window.removeEventListener('focus', check);
    };
  }, []);

  const preview = describeClipboard(text);

  return (
    <ActionCard
      icon={<ClipboardPaste className="h-4 w-4 shrink-0 text-neutral-400" />}
      label={preview.label}
      action={
        <CardButton disabled={!preview.canOpen} onClick={() => text && openClipboardText(text)}>
          Open Clipboard
        </CardButton>
      }
    >
      {preview.snippet && <CardNote className="truncate">{preview.snippet}</CardNote>}
    </ActionCard>
  );
}
