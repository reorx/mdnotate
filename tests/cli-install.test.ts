import { describe, expect, it } from 'vitest';
import {
  describeCliInstall,
  resolveInstallDir,
  type CliInstallEntry,
  type CliInstallStatus,
} from '../src/lib/cli-install';

function entry(overrides: Partial<CliInstallEntry> = {}): CliInstallEntry {
  return {
    dir: '/usr/local/bin',
    path: '/usr/local/bin/mdnotate',
    state: 'missing',
    ...overrides,
  };
}

function status(overrides: Partial<CliInstallStatus> = {}): CliInstallStatus {
  return {
    supported: true,
    appLocation: 'bundled',
    entries: [entry(), entry({ dir: '/Users/x/.local/bin', path: '/Users/x/.local/bin/mdnotate' })],
    ...overrides,
  };
}

describe('describeCliInstall', () => {
  it('reports a loading state while the status has not arrived yet', () => {
    const d = describeCliInstall(null);
    expect(d.state).toBe('loading');
    expect(d.canInstall).toBe(false);
  });

  it('renders nothing on platforms where the command cannot be installed', () => {
    const d = describeCliInstall(status({ supported: false }));
    expect(d.state).toBe('unsupported');
    expect(d.label).toBeNull();
  });

  it('offers to install when the command is nowhere to be found', () => {
    const d = describeCliInstall(status());
    expect(d.state).toBe('not-installed');
    expect(d.canInstall).toBe(true);
    expect(d.canUninstall).toBe(false);
    expect(d.installed).toBeNull();
  });

  it('names the directory the command was installed into', () => {
    const d = describeCliInstall(status({ entries: [entry({ state: 'ours' })] }));
    expect(d.state).toBe('installed');
    expect(d.installed?.dir).toBe('/usr/local/bin');
    // The whole path comes from the same entry rather than being spelled out a
    // second time by whatever renders it.
    expect(d.installed?.path).toBe('/usr/local/bin/mdnotate');
    expect(d.canUninstall).toBe(true);
    expect(d.canInstall).toBe(false);
  });

  // The three states that are not `ours` all mean the same thing to the card:
  // there is no working command here, so the install button stays on offer.
  // Installing over the two symlink cases re-points them, which is why there is
  // no separate repair action.
  it('does not count a symlink left behind by a deleted copy as installed', () => {
    const d = describeCliInstall(status({ entries: [entry({ state: 'dangling' })] }));
    expect(d.state).toBe('not-installed');
    expect(d.canInstall).toBe(true);
  });

  it('does not count a symlink into some other mdnotate as installed', () => {
    const d = describeCliInstall(status({ entries: [entry({ state: 'foreign' })] }));
    expect(d.state).toBe('not-installed');
    expect(d.installed).toBeNull();
  });

  it('does not count somebody else’s file of the same name as installed', () => {
    const d = describeCliInstall(status({ entries: [entry({ state: 'occupied' })] }));
    expect(d.state).toBe('not-installed');
  });

  it('finds the install wherever among the candidates it happens to be', () => {
    const d = describeCliInstall(
      status({ entries: [entry(), entry({ dir: '/opt/bin', path: '/opt/bin/mdnotate', state: 'ours' })] }),
    );
    expect(d.installed?.dir).toBe('/opt/bin');
  });
});

// Installing means symlinking into the running app, so where that app is
// decides whether the link would still resolve tomorrow.
describe('describeCliInstall when the app is somewhere it cannot be linked to', () => {
  it('refuses to install from a development build, which is in no bundle at all', () => {
    const d = describeCliInstall(status({ appLocation: 'unbundled' }));
    expect(d.state).toBe('unavailable');
    expect(d.canInstall).toBe(false);
    expect(d.hint).toMatch(/packaged/i);
  });

  it('refuses to install from a disk image, which the link would outlive', () => {
    const d = describeCliInstall(status({ appLocation: 'removable' }));
    expect(d.state).toBe('unavailable');
    expect(d.canInstall).toBe(false);
    expect(d.hint).toContain('/Applications');
  });

  it('still offers to remove a command installed earlier by a copy that was in the right place', () => {
    const d = describeCliInstall(status({ appLocation: 'removable', entries: [entry({ state: 'ours' })] }));
    expect(d.state).toBe('installed');
    expect(d.canUninstall).toBe(true);
  });
});

// A directory that is not writable takes macOS's own administrator prompt, and
// the user can be looking at that prompt for as long as they like.
describe('describeCliInstall while an install or uninstall is in flight', () => {
  it('waits rather than offering the button again while installing', () => {
    const d = describeCliInstall(status(), 'installing');
    expect(d.state).toBe('installing');
    expect(d.canInstall).toBe(false);
    expect(d.hint).toMatch(/password/i);
  });

  it('keeps showing where the command is while it is being removed', () => {
    const d = describeCliInstall(status({ entries: [entry({ state: 'ours' })] }), 'uninstalling');
    expect(d.state).toBe('uninstalling');
    expect(d.installed?.dir).toBe('/usr/local/bin');
    expect(d.canUninstall).toBe(false);
  });

  it('reports the finished install as soon as the link is there, whatever the phase says', () => {
    const d = describeCliInstall(status({ entries: [entry({ state: 'ours' })] }), 'installing');
    expect(d.state).toBe('installed');
  });
});

// The directory buttons hand this the same strings they show, so `~/.local/bin`
// has to survive it as readily as anything typed by hand does. Outside Tauri
// there is no home directory to ask for, and the `~` is left for the app to
// expand — so what is judged here is the path as it was written.
describe('resolveInstallDir', () => {
  it('takes a full path as it stands', async () => {
    await expect(resolveInstallDir('/opt/bin')).resolves.toBe('/opt/bin');
  });

  it('drops a trailing slash, which a directory dragged in brings with it', async () => {
    await expect(resolveInstallDir('/opt/bin/')).resolves.toBe('/opt/bin');
  });

  // Trimming the slash off `/` leaves nothing, and nothing names the directory
  // the app was started in rather than the root of the disk.
  it('leaves the root of the disk naming the root of the disk', async () => {
    await expect(resolveInstallDir('/')).resolves.toBe('/');
  });

  it('accepts a path still wearing its ~ rather than reading it as relative', async () => {
    await expect(resolveInstallDir('~/.local/bin')).resolves.toBe('~/.local/bin');
  });

  it('undresses a path escaped by a terminal, as the path box does', async () => {
    await expect(resolveInstallDir('"/opt/my bin"')).resolves.toBe('/opt/my bin');
  });

  it('refuses a relative path, which names somewhere nobody chose', async () => {
    await expect(resolveInstallDir('bin')).rejects.toThrow(/full path/);
  });
});
