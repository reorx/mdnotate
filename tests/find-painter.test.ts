import { describe, expect, it } from 'vitest';
import { createFindPainter, FIND_HIGHLIGHT_ACTIVE, FIND_HIGHLIGHT_ALL } from '../src/lib/find-painter';

/**
 * A stand-in for the browser's `Highlight`: a set of ranges. WebKit repaints
 * what these methods touch, and nothing else — see the module under test.
 */
class FakeHighlight {
  ranges = new Set<string>();
  add(range: string) {
    this.ranges.add(range);
    return this;
  }
  clear() {
    this.ranges.clear();
  }
}

/** A stand-in for `CSS.highlights` that remembers every call made on it. */
class FakeRegistry {
  map = new Map<string, FakeHighlight>();
  sets: string[] = [];
  deletes: string[] = [];
  set(name: string, highlight: FakeHighlight) {
    this.sets.push(name);
    this.map.set(name, highlight);
    return this;
  }
  delete(name: string) {
    this.deletes.push(name);
    return this.map.delete(name);
  }
}

const setup = () => {
  const registry = new FakeRegistry();
  const painter = createFindPainter<string>(registry, () => new FakeHighlight());
  const contents = () => ({
    all: [...registry.map.get(FIND_HIGHLIGHT_ALL)!.ranges],
    active: [...registry.map.get(FIND_HIGHLIGHT_ACTIVE)!.ranges],
  });
  return { registry, painter, contents };
};

describe('createFindPainter', () => {
  it('registers both highlights once, up front', () => {
    const { registry } = setup();
    expect(registry.sets).toEqual([FIND_HIGHLIGHT_ALL, FIND_HIGHLIGHT_ACTIVE]);
  });

  it('paints the current match on its own and the rest together', () => {
    const { painter, contents } = setup();
    painter.paint(['a', 'b', 'c'], 1);
    expect(contents()).toEqual({ all: ['a', 'c'], active: ['b'] });
  });

  it('leaves the active highlight empty when there is no current match', () => {
    const { painter, contents } = setup();
    painter.paint(['a', 'b'], -1);
    expect(contents()).toEqual({ all: ['a', 'b'], active: [] });
  });

  it('empties both when cleared', () => {
    const { painter, contents } = setup();
    painter.paint(['a', 'b', 'c'], 0);
    painter.clear();
    expect(contents()).toEqual({ all: [], active: [] });
  });

  it('moves the current match between the two when stepping', () => {
    const { painter, contents } = setup();
    painter.paint(['a', 'b', 'c'], 0);
    painter.paint(['a', 'b', 'c'], 2);
    expect(contents()).toEqual({ all: ['a', 'b'], active: ['c'] });
  });

  // The whole reason this module exists. On the WebKit that ships with macOS,
  // `CSS.highlights.delete()` and `CSS.highlights.set()` over an existing name
  // repaint nothing: the old colour stays on screen until something else
  // happens to redraw that text. Only the Highlight object's own `add` /
  // `delete` / `clear` invalidate the ranges they touch. So the two objects
  // are registered exactly once and mutated in place from then on; a painter
  // that replaced or unregistered them would pass every test above and still
  // leave stale blue behind in the app.
  it('never replaces or unregisters the highlights, whatever it is asked to do', () => {
    const { registry, painter } = setup();
    const before = { all: registry.map.get(FIND_HIGHLIGHT_ALL), active: registry.map.get(FIND_HIGHLIGHT_ACTIVE) };
    painter.paint(['a', 'b'], 0);
    painter.paint(['b', 'c', 'd'], 2);
    painter.clear();
    painter.paint([], -1);
    painter.clear();
    painter.clear();
    expect(registry.sets).toEqual([FIND_HIGHLIGHT_ALL, FIND_HIGHLIGHT_ACTIVE]);
    expect(registry.deletes).toEqual([]);
    expect(registry.map.get(FIND_HIGHLIGHT_ALL)).toBe(before.all);
    expect(registry.map.get(FIND_HIGHLIGHT_ACTIVE)).toBe(before.active);
  });
});
