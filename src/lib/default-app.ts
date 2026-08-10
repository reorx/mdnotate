import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauri-env';

/** Mirrors the Rust `DefaultAppStatus` payload. */
export interface DefaultAppStatus {
  /** False where the default handler cannot be inspected (non-macOS, browser dev). */
  supported: boolean;
  isDefault: boolean;
  /** Bundle identifier currently registered for Markdown, e.g. `com.neovide.neovide`. */
  currentHandlerId: string | null;
  /** Display name of that app, e.g. `Neovide`. */
  currentHandlerName: string | null;
  /** Whether macOS can resolve our own bundle identifier to an installed app. */
  appRegistered: boolean;
}

export type DefaultAppState = 'loading' | 'unsupported' | 'default' | 'not-default' | 'unregistered' | 'awaiting';

/** Where we are in a "make me the default" request the user has to confirm. */
export type DefaultAppPhase = 'idle' | 'awaiting' | 'unconfirmed';

export interface DefaultAppDisplay {
  state: DefaultAppState;
  /** One-line status sentence; null means render nothing. */
  label: string | null;
  /** Secondary line, used to explain why the button is unavailable. */
  hint: string | null;
  canSet: boolean;
}

const AWAITING_HINT = 'macOS is asking you to confirm — choose “Use mdnotate” in the system dialog.';

const FINDER_HINT =
  'macOS did not hand it over. You can also do it in Finder: select a .md file, press ⌘I, then Open with → mdnotate → Change All.';

const UNSUPPORTED: DefaultAppStatus = {
  supported: false,
  isDefault: false,
  currentHandlerId: null,
  currentHandlerName: null,
  appRegistered: false,
};

export function describeDefaultApp(
  status: DefaultAppStatus | null,
  phase: DefaultAppPhase = 'idle',
): DefaultAppDisplay {
  if (!status) {
    return { state: 'loading', label: 'Checking default app…', hint: null, canSet: false };
  }
  if (!status.supported) {
    return { state: 'unsupported', label: null, hint: null, canSet: false };
  }
  if (status.isDefault) {
    return {
      state: 'default',
      label: 'mdnotate opens .md files by default',
      hint: null,
      canSet: false,
    };
  }
  const holder = status.currentHandlerName ?? status.currentHandlerId;
  const label = holder ? `.md files currently open in ${holder}` : '.md files have no default app';
  if (!status.appRegistered) {
    return {
      state: 'unregistered',
      label,
      hint: 'macOS has not registered this copy of mdnotate — move mdnotate.app to /Applications and launch it from there.',
      canSet: false,
    };
  }
  if (phase === 'awaiting') {
    return { state: 'awaiting', label, hint: AWAITING_HINT, canSet: false };
  }
  return { state: 'not-default', label, hint: phase === 'unconfirmed' ? FINDER_HINT : null, canSet: true };
}

/** Stand-in for plain-browser dev, where there is no LaunchServices to ask. */
let devStub: DefaultAppStatus = {
  supported: true,
  isDefault: false,
  currentHandlerId: 'com.example.editor',
  currentHandlerName: 'Some Other Editor',
  appRegistered: true,
};

export async function fetchDefaultAppStatus(): Promise<DefaultAppStatus> {
  if (!isTauri) return import.meta.env.DEV ? devStub : UNSUPPORTED;
  return invoke<DefaultAppStatus>('markdown_default_app_status');
}

/**
 * Ask macOS to hand `.md` over to us. macOS answers with its own consent
 * prompt, so this only queues the request and returns immediately — the caller
 * polls `fetchDefaultAppStatus` to find out what the user chose.
 */
export async function requestDefaultApp(): Promise<void> {
  if (!isTauri) {
    // Mimic the delay of a user clicking through the macOS prompt.
    if (import.meta.env.DEV) {
      setTimeout(() => {
        devStub = { ...devStub, isDefault: true, currentHandlerId: null, currentHandlerName: 'mdnotate' };
      }, 2500);
    }
    return;
  }
  await invoke('set_markdown_default_app');
}
