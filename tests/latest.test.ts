import { describe, expect, it } from 'vitest';
import { createLatest } from '../src/lib/latest';

describe('createLatest', () => {
  it('holds the only attempt there is', () => {
    const opens = createLatest();
    const attempt = opens.start();
    expect(opens.isCurrent(attempt)).toBe(true);
  });

  // The point of the whole thing: a read can take as long as a connection to
  // another machine, and the answer that comes back late is not wanted once
  // the user has asked for something else.
  it('drops an attempt that a later one has overtaken', () => {
    const opens = createLatest();
    const slow = opens.start();
    const quick = opens.start();
    expect(opens.isCurrent(slow)).toBe(false);
    expect(opens.isCurrent(quick)).toBe(true);
  });

  it('keeps holding the newest however many were started', () => {
    const opens = createLatest();
    const attempts = [opens.start(), opens.start(), opens.start()];
    expect(attempts.map(opens.isCurrent)).toEqual([false, false, true]);
  });

  it('counts each dispenser on its own', () => {
    const one = createLatest();
    const other = createLatest();
    const attempt = one.start();
    other.start();
    expect(one.isCurrent(attempt)).toBe(true);
  });
});
