import { describe, expect, it } from 'vitest';
import {
  VIEWS,
  clearSelection,
  initialNav,
  isSelected,
  parseSearch,
  select,
  setView,
  type Selection,
} from './shell-nav';

describe('initialNav', () => {
  it('defaults to trigger with nothing selected', () => {
    const nav = initialNav();
    expect(nav).toEqual({ view: 'trigger', selection: null });
  });

  it('honours a seeded view', () => {
    expect(initialNav({ view: 'patch' })).toMatchObject({ view: 'patch' });
  });
});

describe('VIEWS', () => {
  it('is the rail order — perform · objects · sections · trigger · patch (no kit)', () => {
    expect(VIEWS).toEqual(['perform', 'objects', 'sections', 'trigger', 'patch', 'monitor']);
  });
});

describe('setView', () => {
  it('clears the selection on a real view change', () => {
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
  it('loads the selection and keeps the view', () => {
    const next = select(initialNav(), { kind: 'node', nodeId: 'n-1' });
    expect(next.view).toBe('trigger');
    expect(next.selection).toEqual({ kind: 'node', nodeId: 'n-1' });
  });

  it('clearSelection drops the selection', () => {
    let nav = select(initialNav(), { kind: 'patch', nodeId: 'output' });
    nav = clearSelection(nav);
    expect(nav.selection).toBeNull();
  });

  it('exposes a selected section (rename + recall panel)', () => {
    const next = select(initialNav({ view: 'sections' }), { kind: 'section', sectionId: 'sec-2' });
    expect(next.view).toBe('sections');
    expect(next.selection).toEqual({ kind: 'section', sectionId: 'sec-2' });
  });
});

describe('isSelected', () => {
  const cases: Array<[Selection, Selection, boolean]> = [
    [{ kind: 'node', nodeId: 'a' }, { kind: 'node', nodeId: 'a' }, true],
    [{ kind: 'node', nodeId: 'a' }, { kind: 'node', nodeId: 'b' }, false],
    [{ kind: 'bus', busId: 'base' }, { kind: 'bus', busId: 'base' }, true],
    [{ kind: 'patch', nodeId: 'midi' }, { kind: 'bus', busId: 'midi' }, false],
    [{ kind: 'section', sectionId: 's1' }, { kind: 'section', sectionId: 's1' }, true],
    [{ kind: 'section', sectionId: 's1' }, { kind: 'section', sectionId: 's2' }, false],
  ];
  it.each(cases)('compares %o vs %o → %s', (current, probe, expected) => {
    expect(isSelected(select(initialNav(), current), probe)).toBe(expected);
  });
});

describe('parseSearch', () => {
  it('reads the view deep-link', () => {
    expect(parseSearch('?view=patch')).toEqual({ view: 'patch' });
    expect(parseSearch('?view=perform')).toEqual({ view: 'perform' });
    expect(parseSearch('?view=objects')).toEqual({ view: 'objects' });
    expect(parseSearch('?view=monitor')).toEqual({ view: 'monitor' });
  });
  it('drops unknown / retired views (kit is gone)', () => {
    expect(parseSearch('?view=nope')).toEqual({});
    expect(parseSearch('?view=kit')).toEqual({});
  });
  it('ignores the retired mode param', () => {
    expect(parseSearch('?mode=perform&view=sections')).toEqual({ view: 'sections' });
  });
});
