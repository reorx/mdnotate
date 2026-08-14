import { invoke } from '@tauri-apps/api/core';
import { homeDir } from '@tauri-apps/api/path';
import { expandHome, normalizePathInput } from './path-input';
import { isTauri } from './tauri-env';

/** Mirrors the Rust `LinkState`. Only `ours` is a working command. */
export type LinkState = 'missing' | 'ours' | 'dangling' | 'foreign' | 'occupied';

/** Mirrors the Rust `CliInstallEntry`: one directory, and what is in it. */
export interface CliInstallEntry {
  dir: string;
  path: string;
  state: LinkState;
}

/** Mirrors the Rust `AppLocation`: where the app being linked to is running from. */
export type AppLocation = 'bundled' | 'unbundled' | 'removable';

/** Mirrors the Rust `CliInstallStatus` payload. */
export interface CliInstallStatus {
  /** False where there is no such thing to install (non-macOS, browser dev). */
  supported: boolean;
  appLocation: AppLocation;
  /** Every directory worth looking in, in the order they are offered. */
  entries: CliInstallEntry[];
}

/** Where we are in an install the user may be looking at a password prompt for. */
export type CliInstallPhase = 'idle' | 'installing' | 'uninstalling';

export type CliInstallState =
  | 'loading'
  | 'unsupported'
  | 'unavailable'
  | 'not-installed'
  | 'installing'
  | 'installed'
  | 'uninstalling';

export interface CliInstallDisplay {
  state: CliInstallState;
  /** One-line status sentence; null means render nothing. */
  label: string | null;
  hint: string | null;
  /**
   * Where the working command is: its own path to show, and the directory to
   * hand back when it is to be removed. Null when there is not one.
   */
  installed: CliInstallEntry | null;
  canInstall: boolean;
  canUninstall: boolean;
}

const AUTH_HINT = 'macOS may ask for your password to confirm.';

const UNBUNDLED_HINT =
  'A development build has no bundled script to link to — run a packaged mdnotate.app to install the command.';

const REMOVABLE_HINT =
  'mdnotate is running from a mounted disk image, and a link to it would break as soon as that is ejected. Move mdnotate.app to /Applications and open it from there.';

const UNSUPPORTED: CliInstallStatus = { supported: false, appLocation: 'unbundled', entries: [] };

/** The one entry holding a working command, if any of them does. */
function installedEntry(status: CliInstallStatus): CliInstallEntry | null {
  return status.entries.find((entry) => entry.state === 'ours') ?? null;
}

export function describeCliInstall(
  status: CliInstallStatus | null,
  phase: CliInstallPhase = 'idle',
): CliInstallDisplay {
  if (!status) {
    return {
      state: 'loading',
      label: 'Checking the mdnotate command…',
      hint: null,
      installed: null,
      canInstall: false,
      canUninstall: false,
    };
  }
  if (!status.supported) {
    return {
      state: 'unsupported',
      label: null,
      hint: null,
      installed: null,
      canInstall: false,
      canUninstall: false,
    };
  }
  const installed = installedEntry(status);
  // What is actually on disk comes before anything else, so that a command
  // installed by a copy of the app that has since been moved somewhere it
  // cannot be linked from can still be taken off again.
  if (installed) {
    return {
      state: phase === 'uninstalling' ? 'uninstalling' : 'installed',
      label: 'The mdnotate command is installed',
      hint: phase === 'uninstalling' ? AUTH_HINT : null,
      installed,
      canInstall: false,
      canUninstall: phase !== 'uninstalling',
    };
  }
  if (status.appLocation !== 'bundled') {
    return {
      state: 'unavailable',
      label: 'The mdnotate command cannot be installed from here',
      hint: status.appLocation === 'unbundled' ? UNBUNDLED_HINT : REMOVABLE_HINT,
      installed: null,
      canInstall: false,
      canUninstall: false,
    };
  }
  if (phase === 'installing') {
    return {
      state: 'installing',
      label: 'Installing the mdnotate command…',
      hint: AUTH_HINT,
      installed: null,
      canInstall: false,
      canUninstall: false,
    };
  }
  // Everything that is not a working link — nothing there, a link left behind
  // by an app that is gone, a link to another copy — is offered the same way,
  // because installing over any of them is what puts it right.
  return {
    state: 'not-installed',
    label: 'The mdnotate command is not installed',
    hint: null,
    installed: null,
    canInstall: true,
    canUninstall: false,
  };
}

/**
 * Turn a directory as typed into the absolute one the Rust side wants. Reuses
 * the input-dialect rules the path box on the same screen already follows, and
 * only asks for the home directory when there is a `~` needing it.
 */
export async function resolveInstallDir(raw: string): Promise<string> {
  // Trimmed before it is judged, or `/` would pass as a full path and then be
  // left as the empty string, which names the directory the app happens to
  // have been started in rather than the root of the disk.
  const cleaned = normalizePathInput(raw).replace(/\/+$/, '') || '/';
  // Judged as it was written rather than as it comes out: `~` is only expanded
  // where there is a home directory to ask for, and a path still wearing its
  // `~` outside Tauri must not be mistaken for a relative one.
  if (!cleaned.startsWith('/') && cleaned !== '~' && !cleaned.startsWith('~/')) {
    throw new Error('Enter a directory as a full path, starting with / or ~');
  }
  return cleaned.startsWith('~') && isTauri ? expandHome(cleaned, await homeDir()) : cleaned;
}

/** Stand-in for plain-browser dev, where there is no PATH to install onto. */
let devStub: CliInstallStatus = {
  supported: true,
  appLocation: 'bundled',
  entries: [
    { dir: '/usr/local/bin', path: '/usr/local/bin/mdnotate', state: 'missing' },
    { dir: '~/.local/bin', path: '~/.local/bin/mdnotate', state: 'missing' },
  ],
};

export async function fetchCliInstallStatus(customDir: string | null): Promise<CliInstallStatus> {
  if (!isTauri) return import.meta.env.DEV ? devStub : UNSUPPORTED;
  return invoke<CliInstallStatus>('cli_install_status', { customDir });
}

export async function installCli(dir: string): Promise<void> {
  if (!isTauri) {
    if (!import.meta.env.DEV) return;
    // Slow enough to see the waiting state the real prompt puts up.
    await new Promise((r) => setTimeout(r, 1200));
    const entries = devStub.entries.some((e) => e.dir === dir)
      ? devStub.entries
      : [...devStub.entries, { dir, path: `${dir}/mdnotate`, state: 'missing' as LinkState }];
    devStub = { ...devStub, entries: entries.map((e) => (e.dir === dir ? { ...e, state: 'ours' } : e)) };
    return;
  }
  await invoke('cli_install', { dir });
}

export async function uninstallCli(dir: string): Promise<void> {
  if (!isTauri) {
    if (!import.meta.env.DEV) return;
    await new Promise((r) => setTimeout(r, 800));
    devStub = { ...devStub, entries: devStub.entries.map((e) => (e.dir === dir ? { ...e, state: 'missing' } : e)) };
    return;
  }
  await invoke('cli_uninstall', { dir });
}
