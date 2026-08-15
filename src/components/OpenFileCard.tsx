import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FolderOpen } from 'lucide-react';
import { openFileDialog, openSpec } from '../lib/open-doc';
import { joinPrefixSuffix, upsertPrefix } from '../lib/path-prefix';
import { normalizePathInput } from '../lib/path-input';
import { forgetPrefix, listPrefixes, recordPrefix } from '../lib/path-prefixes-db';
import { useAppStore } from '../store';
import { ActionCard, CardButton, CardNote, CARD_INPUT } from './ActionCard';
import { PrefixCombobox } from './PrefixCombobox';

/**
 * The ways to reach a document that is not on the clipboard: the system dialog,
 * a path pasted straight in — from a terminal, from Finder's "Copy as
 * Pathname", or typed by hand — and the same path in two halves, the remembered
 * directory and the file name. `path-input` untangles whatever shape it arrives
 * in; `doc-locator` decides what it names, which may be a file on another
 * machine (`maiev.ts:Sync/a.md`) or an mdnotate link.
 */
export function OpenFileCard() {
  const [path, setPath] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const suffixRef = useRef<HTMLInputElement>(null);
  const joined = joinPrefixSuffix(prefix, suffix);

  useEffect(() => {
    let alive = true;
    listPrefixes()
      .then((stored) => {
        if (alive) setPrefixes(stored);
      })
      .catch((e) => setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    await openSpec(normalizePathInput(path));
    setPath('');
  };

  const submitParts = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    await openSpec(joined);

    // Only a prefix that led somewhere is worth completing next time — and
    // this is the one moment it is known to have. Remembering it is no reason
    // to keep the document waiting, so the write is not awaited; the banner
    // rather than this card carries what it has to say, since by now the
    // document is on screen and the home screen is not.
    const used = normalizePathInput(prefix);
    if (used) {
      setPrefixes((current) => upsertPrefix(current, used));
      recordPrefix(used, Date.now()).catch((err) =>
        useAppStore.getState().setError(`Opened, but could not remember "${used}": ${err}`),
      );
    }
    setSuffix('');
  };

  const forget = (target: string) => {
    setPrefixes((current) => current.filter((p) => p !== target));
    forgetPrefix(target).catch((e) => setError(String(e)));
  };

  return (
    <ActionCard
      icon={<FolderOpen className="h-4 w-4 shrink-0 text-neutral-400" />}
      label="Read a document from disk or another machine"
      action={<CardButton onClick={() => openFileDialog().catch((e) => setError(String(e)))}>Open File…</CardButton>}
    >
      <form
        className="mt-1.5 flex items-center gap-1.5 pl-6"
        onSubmit={(e) => void submit(e).catch((err) => setError(String(err)))}
      >
        <input
          className={`${CARD_INPUT} flex-1`}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="…or paste /a/path or host:path"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <CardButton variant="secondary" type="submit" disabled={!path.trim()}>
          Open
        </CardButton>
      </form>

      {/* A step darker than a card border: this one has to read against the
          card's own background rather than against the page. */}
      <div className="mt-2.5 ml-6 border-t border-neutral-300" />

      {/* The same path, split where it stops changing. */}
      <form
        className="mt-2.5 flex items-center gap-1.5 pl-6"
        onSubmit={(e) => void submitParts(e).catch((err) => setError(String(err)))}
      >
        <PrefixCombobox
          value={prefix}
          prefixes={prefixes}
          onChange={setPrefix}
          onCommit={() => suffixRef.current?.focus()}
          onForget={forget}
        />
        <input
          ref={suffixRef}
          className={`${CARD_INPUT} flex-[2]`}
          value={suffix}
          onChange={(e) => setSuffix(e.target.value)}
          placeholder="2026-08-15.md"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <CardButton variant="secondary" type="submit" disabled={!joined}>
          Open
        </CardButton>
      </form>
      {/* What the two halves come to, so that the separator put between them is
          somewhere to be seen before it opens the wrong file. */}
      {joined && <CardNote className="truncate">{joined}</CardNote>}

      {error && <CardNote tone="error">{error}</CardNote>}
    </ActionCard>
  );
}
