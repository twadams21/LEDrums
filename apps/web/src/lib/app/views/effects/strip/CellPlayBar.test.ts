// @vitest-environment jsdom
/* The cell's Play bar (Tim, 2026-10-01): Layer / Sequence / Random, and — once a cell steps — its
   reset: section start only, a drum zone, a MIDI note or CC (with Learn), or an OSC address.
   Against the real in-memory authoring api, so what the bar shows is what the section holds. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import { createStandaloneEffectsApi } from '../../../../trigger-lab/effects-controller.svelte';
import CellPlayBar from './CellPlayBar.svelte';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

const kit: KitConfig = { ...DEFAULT_KIT, drums: [{ ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' }, { ...DEFAULT_KIT.drums[0]!, id: 'snare', label: 'Snare' }] };
const KICK = { row: 'kick', column: { kind: 'zone' as const, slot: 0 } };
const fx = (id: string) => effectChain.parseEffect({ id, name: id, cell: KICK, generator: { kind: 'solid' } });

function setup() {
  const api = createStandaloneEffectsApi({ effects: [fx('a'), fx('b')], master: [] }, kit);
  const view = render(CellPlayBar, { props: { api, cell: KICK, steps: 2 } });
  const rerender = () => view.rerender({ api, cell: KICK, steps: 2 });
  return { api, view, rerender, screen: within(document.body) };
}

describe('CellPlayBar', () => {
  it('switches the cell between Layer, Sequence and Random', async () => {
    const { api, view, rerender } = setup();
    expect(view.queryByLabelText('Reset to step 1 on')).toBeNull(); // a layering cell has no reset
    await fireEvent.click(view.getByText('Sequence'));
    expect(api.cellPlay(KICK)?.mode).toBe('sequence');
    await rerender();
    expect(view.getByLabelText('Reset to step 1 on')).toBeTruthy();
    await fireEvent.click(view.getByText('Random'));
    expect(api.cellPlay(KICK)?.mode).toBe('random');
    await fireEvent.click(view.getByText('Layer'));
    expect(api.cellPlay(KICK)).toBeNull();
  });

  it('shows the MIDI-note reset with Learn, which arms on the cell', async () => {
    const { api, view, rerender } = setup();
    api.setCellPlayMode(KICK, 'sequence');
    api.setCellReset(KICK, { kind: 'midiNote', note: 36 });
    await rerender();
    expect((view.getByLabelText('Reset MIDI note') as HTMLInputElement).value).toBe('C2');
    await fireEvent.click(view.getByLabelText('Learn reset MIDI note'));
    expect(api.cellResetLearnCell).toEqual(KICK);
  });

  it('a typed note sets the reset', async () => {
    const { api, view, rerender } = setup();
    api.setCellPlayMode(KICK, 'sequence');
    api.setCellReset(KICK, { kind: 'midiNote', note: 36 });
    await rerender();
    const input = view.getByLabelText('Reset MIDI note') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'D#3' } });
    await fireEvent.blur(input);
    expect(api.cellPlay(KICK)?.reset).toEqual({ kind: 'midiNote', note: 51 });
  });

  it('a drum-zone reset offers the kit’s drums', async () => {
    const { api, view, rerender } = setup();
    api.setCellPlayMode(KICK, 'random');
    api.setCellReset(KICK, { kind: 'zone', drumId: 'snare', slot: 0 });
    await rerender();
    expect(view.getByLabelText('Reset drum').textContent).toContain('Snare');
    expect(view.getByLabelText('Reset zone')).toBeTruthy();
  });

  it('says a one-Effect cell needs another Effect to have steps', async () => {
    const api = createStandaloneEffectsApi({ effects: [fx('a')], master: [] }, kit);
    api.setCellPlayMode(KICK, 'sequence');
    const view = render(CellPlayBar, { props: { api, cell: KICK, steps: 1 } });
    expect(view.getByText(/Add another Effect/)).toBeTruthy();
  });
});
