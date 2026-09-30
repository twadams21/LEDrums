import { describe, expect, it } from 'vitest';
import {
  SETTINGS_PANES,
  VIEWS,
  clearSelection,
  closeSettings,
  initialNav,
  isSelected,
  openSettings,
  parseSearch,
  select,
  setMapMode,
  setView,
  type Selection,
} from './shell-nav';

describe('initialNav', () => {
  it('defaults to trigger with nothing selected and Settings closed', () => {
    const nav = initialNav();
    expect(nav).toEqual({ view: 'trigger', selection: null, settings: null, mapMode: false });
  });

  it('honours a seeded view', () => {
    expect(initialNav({ view: 'sections' })).toMatchObject({ view: 'sections' });
  });

  it('honours a seeded Settings pane (deep-link)', () => {
    expect(initialNav({ settings: 'outputs' })).toMatchObject({ view: 'trigger', settings: 'outputs' });
  });
});

describe('VIEWS', () => {
  it('is the tab order — perform · objects · sections · trigger · monitor (no patch)', () => {
    expect(VIEWS).toEqual(['perform', 'objects', 'sections', 'trigger', 'monitor']);
  });
});

describe('setView', () => {
  it('clears the selection on a real view change', () => {
    let nav = select(initialNav(), { kind: 'bus', busId: 'base' });
    expect(nav.selection).not.toBeNull();
    nav = setView(nav, 'monitor');
    expect(nav.view).toBe('monitor');
    expect(nav.selection).toBeNull();
  });

  it('is a no-op (same reference) when the view is unchanged', () => {
    const nav = select(initialNav(), { kind: 'bus', busId: 'base' });
    expect(setView(nav, nav.view)).toBe(nav); // selection preserved
  });
});

describe('select', () => {
  it('loads the selection and keeps the view', () => {
    const next = select(initialNav(), { kind: 'bus', busId: 'base' });
    expect(next.view).toBe('trigger');
    expect(next.selection).toEqual({ kind: 'bus', busId: 'base' });
  });

  it('clearSelection drops the selection', () => {
    let nav = select(initialNav(), { kind: 'bus', busId: 'base' });
    nav = clearSelection(nav);
    expect(nav.selection).toBeNull();
  });

  it('exposes a selected section (rename + recall panel)', () => {
    const next = select(initialNav({ view: 'sections' }), { kind: 'section', sectionId: 'sec-2' });
    expect(next.view).toBe('sections');
    expect(next.selection).toEqual({ kind: 'section', sectionId: 'sec-2' });
  });
});

describe('openSettings / closeSettings', () => {
  it('opens on the default pane and closes back to null', () => {
    let nav = openSettings(initialNav());
    expect(nav.settings).toBe('input');
    nav = closeSettings(nav);
    expect(nav.settings).toBeNull();
  });

  it('opens on a named pane without touching view or selection', () => {
    let nav = select(initialNav({ view: 'sections' }), { kind: 'section', sectionId: 's1' });
    nav = openSettings(nav, 'controller');
    expect(nav.settings).toBe('controller');
    expect(nav.view).toBe('sections');
    expect(nav.selection).toEqual({ kind: 'section', sectionId: 's1' });
  });

  it('is a no-op (same reference) when already in the requested state', () => {
    const open = openSettings(initialNav(), 'drums');
    expect(openSettings(open, 'drums')).toBe(open);
    const closed = initialNav();
    expect(closeSettings(closed)).toBe(closed);
  });

  it('switches pane in place while open', () => {
    const nav = openSettings(openSettings(initialNav(), 'input'), 'system');
    expect(nav.settings).toBe('system');
  });
});

describe('SETTINGS_PANES', () => {
  it('is the section order — no general catch-all', () => {
    expect(SETTINGS_PANES).toEqual(['input', 'zones', 'controls', 'drums', 'outputs', 'controller', 'system']);
  });
});

describe('isSelected', () => {
  const cases: Array<[Selection, Selection, boolean]> = [
    [{ kind: 'bus', busId: 'base' }, { kind: 'bus', busId: 'base' }, true],
    [{ kind: 'bus', busId: 'base' }, { kind: 'bus', busId: 'fx' }, false],
    [{ kind: 'section', sectionId: 'base' }, { kind: 'bus', busId: 'base' }, false],
    [{ kind: 'section', sectionId: 's1' }, { kind: 'section', sectionId: 's1' }, true],
    [{ kind: 'section', sectionId: 's1' }, { kind: 'section', sectionId: 's2' }, false],
  ];
  it.each(cases)('compares %o vs %o → %s', (current, probe, expected) => {
    expect(isSelected(select(initialNav(), current), probe)).toBe(expected);
  });
});

describe('parseSearch', () => {
  it('reads the view deep-link', () => {
    expect(parseSearch('?view=perform')).toEqual({ view: 'perform' });
    expect(parseSearch('?view=objects')).toEqual({ view: 'objects' });
    expect(parseSearch('?view=monitor')).toEqual({ view: 'monitor' });
  });
  it('redirects the retired patch view to Settings › Outputs (old URLs keep working)', () => {
    expect(parseSearch('?view=patch')).toEqual({ settings: 'outputs' });
  });
  it('reads the Settings-pane deep-link', () => {
    expect(parseSearch('?settings=outputs')).toEqual({ settings: 'outputs' });
    expect(parseSearch('?view=sections&settings=controller')).toEqual({ view: 'sections', settings: 'controller' });
  });
  it('reads the sections split out of Input', () => {
    expect(parseSearch('?settings=zones')).toEqual({ settings: 'zones' });
    expect(parseSearch('?settings=controls')).toEqual({ settings: 'controls' });
  });
  it('drops unknown views and panes (kit is gone)', () => {
    expect(parseSearch('?view=nope')).toEqual({});
    expect(parseSearch('?view=kit')).toEqual({});
    expect(parseSearch('?settings=nope')).toEqual({});
  });
  it('ignores the retired mode param', () => {
    expect(parseSearch('?mode=perform&view=sections')).toEqual({ view: 'sections' });
  });
});

describe('setMapMode', () => {
  it('enters and leaves map mode without touching the view, selection or Settings', () => {
    const base = select(openSettings(initialNav({ view: 'sections' }), 'zones'), { kind: 'section', sectionId: 's1' });
    const on = setMapMode(base, true);
    expect(on).toEqual({ ...base, mapMode: true });
    expect(setMapMode(on, false)).toEqual(base);
  });

  it('is a no-op (same object) when already in the requested state', () => {
    const nav = initialNav();
    expect(setMapMode(nav, false)).toBe(nav);
  });

  it('survives a view switch — mapping spans every view', () => {
    expect(setView(setMapMode(initialNav(), true), 'perform').mapMode).toBe(true);
  });
});
