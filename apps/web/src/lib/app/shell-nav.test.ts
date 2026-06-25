import { describe, expect, it } from 'vitest';
import {
  clearSelection,
  initialNav,
  isSelected,
  parseSearch,
  select,
  setDock,
  setMode,
  setView,
  type Selection,
} from './shell-nav';

describe('initialNav', () => {
  it('defaults to author / trigger / inspector with nothing selected', () => {
    const nav = initialNav();
    expect(nav).toEqual({ mode: 'author', view: 'trigger', dock: 'inspector', selection: null });
  });

  it('honours seeded mode + view', () => {
    expect(initialNav({ mode: 'perform', view: 'patch' })).toMatchObject({ mode: 'perform', view: 'patch' });
  });
});

describe('setView', () => {
  it('clears the Inspector selection on a real view change', () => {
    let nav = select(initialNav(), { kind: 'bus', busId: 'base' });
    expect(nav.selection).not.toBeNull();
    nav = setView(nav, 'patch');
    expect(nav.view).toBe('patch');
    expect(nav.selection).toBeNull();
  });

  it('is a no-op (same reference) when the view is unchanged', () => {
    const nav = select(initialNav(), { kind: 'bus', busId: 'base' });
    expect(setView(nav, nav.view)).toBe(nav); // selection preserved
  });
});

describe('select', () => {
  it('surfaces the Inspector tab whenever something is selected', () => {
    const nav = setDock(initialNav(), 'monitor');
    expect(nav.dock).toBe('monitor');
    const next = select(nav, { kind: 'node', nodeId: 'n-1' });
    expect(next.dock).toBe('inspector');
    expect(next.selection).toEqual({ kind: 'node', nodeId: 'n-1' });
  });

  it('clearSelection drops the selection but leaves the dock', () => {
    let nav = select(initialNav(), { kind: 'patch', nodeId: 'output' });
    nav = clearSelection(nav);
    expect(nav.selection).toBeNull();
    expect(nav.dock).toBe('inspector');
  });
});

describe('setMode / setDock preserve selection', () => {
  it('switching mode keeps the current view + selection', () => {
    const nav = select(initialNav({ view: 'sections' }), { kind: 'bus', busId: 'effect' });
    const next = setMode(nav, 'perform');
    expect(next.mode).toBe('perform');
    expect(next.view).toBe('sections');
    expect(next.selection).toEqual({ kind: 'bus', busId: 'effect' });
  });
});

describe('isSelected', () => {
  const cases: Array<[Selection, Selection, boolean]> = [
    [{ kind: 'node', nodeId: 'a' }, { kind: 'node', nodeId: 'a' }, true],
    [{ kind: 'node', nodeId: 'a' }, { kind: 'node', nodeId: 'b' }, false],
    [{ kind: 'bus', busId: 'base' }, { kind: 'bus', busId: 'base' }, true],
    [{ kind: 'patch', nodeId: 'midi' }, { kind: 'bus', busId: 'midi' }, false],
  ];
  it.each(cases)('compares %o vs %o → %s', (current, probe, expected) => {
    expect(isSelected(select(initialNav(), current), probe)).toBe(expected);
  });
});

describe('parseSearch', () => {
  it('reads mode + view', () => {
    expect(parseSearch('?mode=perform&view=kit')).toEqual({ mode: 'perform', view: 'kit' });
  });
  it('accepts legacy mode spellings', () => {
    expect(parseSearch('?mode=performance')).toEqual({ mode: 'perform' });
    expect(parseSearch('?mode=authoring')).toEqual({ mode: 'author' });
  });
  it('drops unknown values', () => {
    expect(parseSearch('?mode=bogus&view=nope')).toEqual({});
  });
});
