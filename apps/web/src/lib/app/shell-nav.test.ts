/* Shell navigation behaviour. Until INIT-02 S17 these cases drove a pure reducer in shell-nav.ts;
   the reducer is now inlined into ShellStore, so they drive `new ShellStore()` directly — rune
   classes construct fine in this repo's node test env (store.*.test.ts does it throughout).

   EVERY case from the reducer suite survives, one-for-one (17 of them). The one that matters most
   is "clears the selection on a real view change": that invariant is the entire reason the module
   existed, and it must not have been lost in the move. */

import { describe, expect, it } from 'vitest';
import { ShellStore } from './shell-store.svelte';
import { VIEWS, parseSearch, type Selection } from './shell-nav';

describe('initial state', () => {
  it('defaults to trigger with nothing selected', () => {
    const shell = new ShellStore();
    expect({ view: shell.view, selection: shell.selection }).toEqual({ view: 'trigger', selection: null });
  });

  it('honours a seeded view', () => {
    expect(new ShellStore({ view: 'patch' }).view).toBe('patch');
  });
});

describe('VIEWS', () => {
  it('is the rail order — perform · objects · sections · trigger · patch (no kit)', () => {
    expect(VIEWS).toEqual(['perform', 'objects', 'sections', 'trigger', 'patch', 'monitor']);
  });
});

describe('setView', () => {
  it('clears the selection on a real view change', () => {
    const shell = new ShellStore();
    shell.select({ kind: 'bus', busId: 'base' });
    expect(shell.selection).not.toBeNull();
    shell.setView('patch');
    expect(shell.view).toBe('patch');
    expect(shell.selection).toBeNull();
  });

  it('is a no-op when the view is unchanged (selection preserved)', () => {
    const shell = new ShellStore();
    const selection: Selection = { kind: 'bus', busId: 'base' };
    shell.select(selection);
    shell.setView(shell.view);
    expect(shell.view).toBe('trigger');
    expect(shell.selection).toEqual(selection); // NOT cleared — the guard is what saves it
  });
});

describe('select', () => {
  it('loads the selection and keeps the view', () => {
    const shell = new ShellStore();
    shell.select({ kind: 'node', nodeId: 'n-1' });
    expect(shell.view).toBe('trigger');
    expect(shell.selection).toEqual({ kind: 'node', nodeId: 'n-1' });
  });

  it('clearSelection drops the selection', () => {
    const shell = new ShellStore();
    shell.select({ kind: 'patch', nodeId: 'output' });
    shell.clearSelection();
    expect(shell.selection).toBeNull();
  });

  it('exposes a selected section (rename + recall panel)', () => {
    const shell = new ShellStore({ view: 'sections' });
    shell.select({ kind: 'section', sectionId: 'sec-2' });
    expect(shell.view).toBe('sections');
    expect(shell.selection).toEqual({ kind: 'section', sectionId: 'sec-2' });
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
    const shell = new ShellStore();
    shell.select(current);
    expect(shell.isSelected(probe)).toBe(expected);
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
