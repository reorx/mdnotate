import { describe, expect, it } from 'vitest';
import { describeDefaultApp, type DefaultAppStatus } from '../src/lib/default-app';

function status(overrides: Partial<DefaultAppStatus> = {}): DefaultAppStatus {
  return {
    supported: true,
    isDefault: false,
    currentHandlerId: null,
    currentHandlerName: null,
    appRegistered: true,
    ...overrides,
  };
}

describe('describeDefaultApp', () => {
  it('reports a loading state while the status has not arrived yet', () => {
    const d = describeDefaultApp(null);
    expect(d.state).toBe('loading');
    expect(d.canSet).toBe(false);
  });

  it('renders nothing on platforms where the handler cannot be inspected', () => {
    const d = describeDefaultApp(status({ supported: false }));
    expect(d.state).toBe('unsupported');
    expect(d.label).toBeNull();
    expect(d.canSet).toBe(false);
  });

  it('confirms mdnotate is the default and offers no button', () => {
    const d = describeDefaultApp(status({ isDefault: true, currentHandlerName: 'mdnotate' }));
    expect(d.state).toBe('default');
    expect(d.label).toContain('mdnotate');
    expect(d.canSet).toBe(false);
  });

  it('names the app that currently owns .md files and offers the button', () => {
    const d = describeDefaultApp(status({ currentHandlerName: 'Neovide', currentHandlerId: 'com.neovide.neovide' }));
    expect(d.state).toBe('not-default');
    expect(d.label).toContain('Neovide');
    expect(d.canSet).toBe(true);
  });

  it('falls back to the bundle identifier when the app name cannot be resolved', () => {
    const d = describeDefaultApp(status({ currentHandlerId: 'com.neovide.neovide' }));
    expect(d.label).toContain('com.neovide.neovide');
    expect(d.canSet).toBe(true);
  });

  it('handles .md having no default app at all', () => {
    const d = describeDefaultApp(status());
    expect(d.state).toBe('not-default');
    expect(d.label).toContain('no default app');
    expect(d.canSet).toBe(true);
  });

  it('explains why the button is unavailable when macOS has not registered this copy', () => {
    const d = describeDefaultApp(status({ appRegistered: false, currentHandlerName: 'Neovide' }));
    expect(d.state).toBe('unregistered');
    expect(d.canSet).toBe(false);
    expect(d.hint).toContain('/Applications');
  });

  it('trusts isDefault even if the registration lookup came back empty', () => {
    const d = describeDefaultApp(status({ isDefault: true, appRegistered: false }));
    expect(d.state).toBe('default');
  });
});

// macOS answers a "make me the default" request with a consent prompt, so the
// handler only changes once the user clicks through it — never synchronously.
describe('describeDefaultApp while a request is in flight', () => {
  it('waits on the macOS prompt instead of declaring failure', () => {
    const d = describeDefaultApp(status({ currentHandlerName: 'Neovide' }), 'awaiting');
    expect(d.state).toBe('awaiting');
    expect(d.canSet).toBe(false);
    expect(d.hint).toMatch(/confirm/i);
  });

  it('stops waiting once macOS reports the handover', () => {
    const d = describeDefaultApp(status({ isDefault: true }), 'awaiting');
    expect(d.state).toBe('default');
    expect(d.hint).toBeNull();
  });

  it('offers the Finder route when the prompt was never answered', () => {
    const d = describeDefaultApp(status({ currentHandlerName: 'Neovide' }), 'unconfirmed');
    expect(d.state).toBe('not-default');
    expect(d.hint).toContain('Finder');
    expect(d.canSet).toBe(true);
  });
});
