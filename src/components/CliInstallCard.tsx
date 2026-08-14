import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, CircleCheck, LoaderCircle, SquareTerminal } from 'lucide-react';
import {
  describeCliInstall,
  fetchCliInstallStatus,
  installCli,
  resolveInstallDir,
  uninstallCli,
  type CliInstallPhase,
  type CliInstallStatus,
} from '../lib/cli-install';
import { saveSettings } from '../lib/settings';
import { useAppStore } from '../store';
import { ActionCard, CardButton, CardNote } from './ActionCard';

const ICONS = {
  loading: { Icon: LoaderCircle, className: 'text-neutral-400 animate-spin' },
  installing: { Icon: LoaderCircle, className: 'text-amber-500 animate-spin' },
  uninstalling: { Icon: LoaderCircle, className: 'text-amber-500 animate-spin' },
  installed: { Icon: CircleCheck, className: 'text-green-600' },
  'not-installed': { Icon: SquareTerminal, className: 'text-neutral-400' },
  unavailable: { Icon: CircleAlert, className: 'text-amber-500' },
} as const;

/** The two directories offered without anything having to be typed. */
const TARGETS = ['/usr/local/bin', '~/.local/bin'];

/**
 * "Is the `mdnotate` command on the PATH?" panel for the empty main screen.
 *
 * The button only opens the choice of where to put it; installing is a click
 * on one of those. A directory belonging to root takes macOS's own
 * administrator prompt, which the user can leave standing for as long as they
 * like — so the waiting state is a real one, not a formality.
 */
export function CliInstallCard() {
  const cliInstallDir = useAppStore((s) => s.settings.cliInstallDir);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [status, setStatus] = useState<CliInstallStatus | null>(null);
  const [phase, setPhase] = useState<CliInstallPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [dir, setDir] = useState(cliInstallDir ?? '');
  const alive = useRef(true);

  // The directory to look in besides the two fixed ones is normally the
  // remembered one, but a just-installed directory has to be passed in: the
  // setting reaches this function through a re-render, and the install that
  // wrote it is still running with the value from before.
  const refresh = useCallback(
    async (customDir: string | null = cliInstallDir) => {
      const next = await fetchCliInstallStatus(customDir);
      if (alive.current) setStatus(next);
    },
    [cliInstallDir],
  );

  useEffect(() => {
    alive.current = true;
    const check = () => refresh().catch((e) => setError(String(e)));
    check();
    // Also on focus: the command can just as well be removed in a terminal,
    // and coming back to the window is when that would have just happened.
    window.addEventListener('focus', check);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', check);
    };
  }, [refresh]);

  const close = () => {
    setChoosing(false);
    setTyping(false);
  };

  /** `remember` for a directory that was typed: only those need finding again. */
  const install = async (raw: string, remember: boolean) => {
    setError(null);
    close();
    setPhase('installing');
    let installed: string | null = null;
    try {
      const target = await resolveInstallDir(raw);
      await installCli(target);
      installed = target;
      if (remember && target !== cliInstallDir) {
        updateSettings({ cliInstallDir: target });
        await saveSettings({ cliInstallDir: target });
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    }
    if (alive.current) setPhase('idle');
    await refresh(remember ? installed : cliInstallDir);
  };

  const uninstall = async (target: string) => {
    setError(null);
    setPhase('uninstalling');
    try {
      await uninstallCli(target);
    } catch (e) {
      if (alive.current) setError(String(e));
    }
    if (alive.current) setPhase('idle');
    await refresh();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void install(dir, true);
  };

  const display = describeCliInstall(status, phase);
  // Pulled out so that the check below still counts inside the click handler.
  const { installed } = display;
  if (display.state === 'unsupported') return null;
  const { Icon, className } = ICONS[display.state];
  // The picker is closed by anything that makes it pointless — including a
  // refresh on focus finding the command installed some other way.
  const picking = choosing && display.canInstall;

  return (
    <ActionCard
      icon={<Icon className={`h-4 w-4 shrink-0 ${className}`} />}
      label={display.label}
      action={
        picking ? (
          <CardButton variant="secondary" onClick={close}>
            Cancel
          </CardButton>
        ) : display.canInstall ? (
          <CardButton variant="secondary" onClick={() => setChoosing(true)}>
            Install…
          </CardButton>
        ) : display.canUninstall && installed ? (
          <CardButton variant="secondary" onClick={() => void uninstall(installed.dir)}>
            Uninstall
          </CardButton>
        ) : null
      }
    >
      {installed && (
        <p className="mt-1 pl-6 font-mono text-[11px] leading-snug break-all text-neutral-700">{installed.path}</p>
      )}
      {display.hint && <CardNote>{display.hint}</CardNote>}
      {picking && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
          {TARGETS.map((target) => (
            <CardButton key={target} variant="secondary" onClick={() => void install(target, false)}>
              {target}
            </CardButton>
          ))}
          <CardButton variant="secondary" onClick={() => setTyping(true)}>
            Custom…
          </CardButton>
        </div>
      )}
      {picking && typing && (
        <form className="mt-1.5 flex items-center gap-1.5 pl-6" onSubmit={submit}>
          <input
            className="min-w-0 flex-1 rounded border border-neutral-300 bg-page px-2 py-1 text-[12px] text-neutral-700 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            placeholder="…or a directory of your own, like ~/bin"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
          />
          <CardButton variant="secondary" type="submit" disabled={!dir.trim()}>
            Install
          </CardButton>
        </form>
      )}
      {error && <CardNote tone="error">{error}</CardNote>}
    </ActionCard>
  );
}
