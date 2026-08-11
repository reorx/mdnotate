import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import {
  describeDefaultApp,
  fetchDefaultAppStatus,
  requestDefaultApp,
  type DefaultAppPhase,
  type DefaultAppStatus,
} from '../lib/default-app';
import { ActionCard, CardButton, CardNote } from './ActionCard';

const ICONS = {
  loading: { Icon: LoaderCircle, className: 'text-neutral-400 animate-spin' },
  awaiting: { Icon: LoaderCircle, className: 'text-amber-500 animate-spin' },
  default: { Icon: CircleCheck, className: 'text-green-600' },
  'not-default': { Icon: CircleAlert, className: 'text-amber-500' },
  unregistered: { Icon: CircleAlert, className: 'text-amber-500' },
  unsupported: { Icon: CircleAlert, className: 'text-neutral-400' },
} as const;

/** How long to keep watching after the macOS consent prompt goes up. */
const POLL_INTERVAL_MS = 700;
const POLL_TIMEOUT_MS = 60_000;

/**
 * "Is mdnotate the default .md app?" panel for the empty main screen.
 *
 * Clicking the button only asks — macOS raises its own "Use mdnotate / Keep
 * <other>" prompt and rewrites the association after the user answers, so the
 * outcome has to be polled rather than read back from the call.
 */
export function DefaultAppCard() {
  const [status, setStatus] = useState<DefaultAppStatus | null>(null);
  const [phase, setPhase] = useState<DefaultAppPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const next = await fetchDefaultAppStatus();
    if (alive.current) setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    alive.current = true;
    const check = () => refresh().catch((e) => setError(String(e)));
    check();
    // Also re-check on focus, so a change made in Finder shows up on return.
    window.addEventListener('focus', check);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', check);
    };
  }, [refresh]);

  const waitForHandover = async () => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!alive.current) return true;
      if ((await refresh()).isDefault) return true;
    }
    return false;
  };

  const request = async () => {
    setError(null);
    setPhase('awaiting');
    try {
      await requestDefaultApp();
      setPhase((await waitForHandover()) ? 'idle' : 'unconfirmed');
    } catch (e) {
      setError(String(e));
      setPhase('idle');
    }
  };

  const display = describeDefaultApp(status, phase);
  if (display.state === 'unsupported') return null;
  const { Icon, className } = ICONS[display.state];

  return (
    <ActionCard
      icon={<Icon className={`h-4 w-4 shrink-0 ${className}`} />}
      label={display.label}
      action={
        display.canSet && (
          <CardButton variant="secondary" onClick={() => void request()}>
            Set as Default
          </CardButton>
        )
      }
    >
      {display.hint && <CardNote>{display.hint}</CardNote>}
      {error && <CardNote tone="error">{error}</CardNote>}
    </ActionCard>
  );
}
