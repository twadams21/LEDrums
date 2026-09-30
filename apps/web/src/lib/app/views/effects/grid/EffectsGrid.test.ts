// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { DEFAULT_KIT, effectChain, inputMapSchema, type KitConfig } from '@ledrums/core';
import { MASTER_CELL } from '../../../../trigger-lab/effects-api';
import { createStandaloneEffectsApi } from '../../../../trigger-lab/effects-controller.svelte';
import type { EffectsSection } from '../../../../trigger-lab/effects-doc';
import AppKeyboardCapture from '../../../AppKeyboardCapture.svelte';
import type { AppKeyboardShell, AppKeyboardStore } from '../../../app-keyboard';
import EffectsGrid from './EffectsGrid.svelte';

/* The Effects grid over the real standalone authoring api: what renders, how selection, roving
   focus, the Generator picker and the cell menu drive the api, and that digit audition still
   reaches the api through the app keyboard seam while a cell has focus. */

type EffectCell = effectChain.EffectCell;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const kit: KitConfig = {
  ...DEFAULT_KIT,
  drums: [
    { ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' },
    { ...DEFAULT_KIT.drums[0]!, id: 'snare', label: 'Snare' },
  ],
};
// Kick has zones 0 + 1, Snare only zone 0 → Snare's zone-1 cell is disabled.
const inputMap = inputMapSchema.parse({
  zones: [
    { drumId: 'kick', slot: 0 },
    { drumId: 'kick', slot: 1 },
    { drumId: 'snare', slot: 0 },
  ],
});
const kickHead: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const kickAlways: EffectCell = { row: 'kick', column: { kind: 'always' } };
const fx = (id: string, cell: EffectCell, extra: Record<string, unknown> = {}) =>
  effectChain.parseEffect({ id, name: id, cell, generator: { kind: 'solid' }, ...extra });

function mount(effects: effectChain.Effect[] = [fx('pulse', kickHead)], canEdit = true) {
  const section: EffectsSection = { effects, master: [] };
  const api = createStandaloneEffectsApi(section, kit, { inputMap, canEdit });
  const r = render(EffectsGrid, { props: { api } });
  return { api, ...r };
}

const cells = () => [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
const cellAt = (row: number, col: number) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-row="${row}"][data-col="${col}"]`)!;

describe('EffectsGrid', () => {
  it('lays out the Kit + drum rows by zone and trigger columns, disabling cells that cannot hold Effects', () => {
    mount();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Row', 'Center', 'Edge', 'Always', 'Clock', 'Cue']);
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent?.trim())).toEqual(['Kit', 'Kick', 'Snare']);
    // Kit zones and Snare's missing zone are disabled and out of the tab order.
    for (const [r, c] of [[0, 0], [0, 1], [2, 1]] as const) {
      expect(cellAt(r, c).getAttribute('aria-disabled')).toBe('true');
      expect(cellAt(r, c).hasAttribute('tabindex')).toBe(false);
    }
    expect(cellAt(1, 0).getAttribute('aria-label')).toBe('Kick center, 1 effect, pulse');
    expect(cellAt(0, -1).getAttribute('aria-label')).toBe('Master, No modifiers');
    // One roving tab stop.
    expect(cells().filter((c) => c.tabIndex === 0)).toHaveLength(1);
  });

  it('a click selects the cell (and its first Effect); a disabled cell ignores it', async () => {
    const { api } = mount();
    await fireEvent.click(cellAt(1, 0));
    expect(api.selectedCell).toEqual(kickHead);
    expect(api.selectedEffectId).toBe('pulse');
    expect(cellAt(1, 0).getAttribute('aria-selected')).toBe('true');
    await fireEvent.click(cellAt(0, 0));
    expect(api.selectedCell).toEqual(kickHead);
  });

  it('arrow keys move one roving focus, skipping disabled cells; Enter and Space select', async () => {
    const { api } = mount();
    const start = cellAt(1, 0);
    start.focus();
    await fireEvent.focus(start);
    await fireEvent.keyDown(start, { key: 'ArrowDown' });
    await tick();
    expect(document.activeElement).toBe(cellAt(2, 0));
    await fireEvent.keyDown(cellAt(2, 0), { key: 'ArrowRight' }); // skips Snare's missing zone
    await tick();
    expect(document.activeElement).toBe(cellAt(2, 2));
    expect(cellAt(2, 2).tabIndex).toBe(0);
    await fireEvent.keyDown(cellAt(2, 2), { key: 'Enter' });
    expect(api.selectedCell).toEqual({ row: 'snare', column: { kind: 'always' } });
    await fireEvent.keyDown(cellAt(2, 2), { key: 'ArrowUp' });
    await fireEvent.keyDown(cellAt(2, 2), { key: 'ArrowUp' });
    await tick();
    expect(document.activeElement).toBe(cellAt(0, 2));
    await fireEvent.keyDown(cellAt(0, 2), { key: 'Home' }); // the Kit row starts with the Master
    await tick();
    expect(document.activeElement).toBe(cellAt(0, -1));
    await fireEvent.keyDown(cellAt(0, -1), { key: ' ' });
    expect(api.selectedCell).toBe(MASTER_CELL);
  });

  it('double-click on an empty cell opens the Generator picker; a pick adds that Effect there', async () => {
    const { api } = mount();
    await fireEvent.dblClick(cellAt(1, 2));
    const menu = await screen.findByRole('menu', { name: 'Add Effect to Always' });
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    await fireEvent.click(screen.getByRole('menuitem', { name: /Wave/ }));
    expect(menu.isConnected).toBe(false);
    const added = api.cellEffects(kickAlways);
    expect(added.map((e) => e.generator.kind)).toEqual(['wave']);
    expect(api.selectedEffectId).toBe(added[0]!.id);
    expect(cellAt(1, 2).getAttribute('aria-label')).toMatch(/^Kick Always, 1 effect/);
  });

  it('Esc closes the picker without adding and returns focus to the cell', async () => {
    const { api } = mount();
    await fireEvent.dblClick(cellAt(1, 2));
    const item = await screen.findByRole('menuitem', { name: /Solid/ });
    await fireEvent.keyDown(item, { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(cellAt(1, 2));
    expect(api.cellEffects(kickAlways)).toHaveLength(0);
  });

  it('double-click on a filled cell only selects it; a viewer never gets the picker', async () => {
    mount();
    await fireEvent.dblClick(cellAt(1, 0));
    expect(screen.queryByRole('menu')).toBeNull();
    cleanup();
    mount([], false);
    await fireEvent.dblClick(cellAt(1, 2));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a fire flashes the cell', async () => {
    const { api } = mount();
    expect(cellAt(1, 0).querySelector('.flash')).toBeNull();
    api.fireCell(kickHead);
    await tick();
    expect(cellAt(1, 0).querySelector('.flash')).not.toBeNull();
  });

  it('the right-click menu acts on the cell it was opened over', async () => {
    const { api } = mount([fx('a', kickHead), fx('b', kickHead)]);
    await fireEvent.contextMenu(cellAt(1, 0));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy cell' }));
    await fireEvent.contextMenu(cellAt(1, 2));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Paste into cell' }));
    expect(api.cellEffects(kickAlways).map((e) => e.name)).toEqual(['a', 'b']);
    await fireEvent.contextMenu(cellAt(1, 0));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Clear cell' }));
    expect(api.cellEffects(kickHead)).toHaveLength(0);
  });

  it('the menu’s Add Effect… opens the Generator picker for that cell', async () => {
    const { api } = mount();
    await fireEvent.contextMenu(cellAt(1, 2));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Add Effect…' }));
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Particles/ }));
    expect(api.cellEffects(kickAlways).map((e) => e.generator.kind)).toEqual(['particles']);
  });

  it('no menu opens over a disabled cell or a header', async () => {
    mount();
    const onDisabled = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    cellAt(0, 0).dispatchEvent(onDisabled);
    const onHeader = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    screen.getAllByRole('columnheader')[1]!.dispatchEvent(onHeader);
    await tick();
    expect(onDisabled.defaultPrevented).toBe(true);
    expect(onHeader.defaultPrevented).toBe(true);
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});

describe('EffectsGrid keyboard audition (app keyboard seam)', () => {
  function withKeyboard(effects: effectChain.Effect[]) {
    const m = mount(effects);
    const store: AppKeyboardStore = {
      stepSetlist: vi.fn(() => true),
      fireEffectAt: (i) => m.api.fireEffectAt(i),
    };
    const shell: AppKeyboardShell = { view: 'trigger', settingsPane: null };
    render(AppKeyboardCapture, { props: { store, shell, shortcuts: [], shortcutPlatform: 'mac' } });
    return { ...m, store };
  }
  const press = (target: EventTarget, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  it('digits fire the section’s nth Effect in grid order, even while a cell has focus', () => {
    const { api } = withKeyboard([fx('snareHit', { row: 'snare', column: { kind: 'zone', slot: 0 } }), fx('kickHit', kickHead)]);
    cellAt(1, 0).focus();
    const first = press(cellAt(1, 0), '1');
    press(cellAt(1, 0), '2');
    // Grid order is row by row: Kick's Effect is 1, Snare's is 2 — not composition order.
    expect(api.fired).toEqual(['effect:kickHit', 'effect:snareHit']);
    expect(first.defaultPrevented).toBe(true);
  });

  it('digits yield while the Generator picker is open', async () => {
    const { api } = withKeyboard([fx('kickHit', kickHead)]);
    await fireEvent.dblClick(cellAt(1, 2));
    const item = await screen.findByRole('menuitem', { name: /Solid/ });
    press(item, '1');
    expect(api.fired).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeNull());
  });
});
