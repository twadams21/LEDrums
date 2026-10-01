// @vitest-environment jsdom
/* The Splice card's sections against the real in-memory authoring api (Tim, 2026-10-01: the
   graph inspector's sections and words, in the new layout): what shows when, and what each
   control writes — one undo step per edit. */
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import { createStandaloneEffectsApi } from '../../../../../trigger-lab/effects-controller.svelte';
import GeneratorCard from './GeneratorCard.svelte';

beforeAll(() => {
  globalThis.IntersectionObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof IntersectionObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const kit: KitConfig = {
  ...DEFAULT_KIT,
  drums: [
    { ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' },
    { ...DEFAULT_KIT.drums[0]!, id: 'snare', label: 'Snare' },
  ],
};
const cell = { row: 'kick', column: { kind: 'zone' as const, slot: 0 } };

function setup(params: Record<string, unknown> = {}, target: unknown = { kind: 'kit' }) {
  const effect = effectChain.parseEffect({ id: 'e1', name: 'Cut', cell, target, generator: { kind: 'splice', params } });
  const api = createStandaloneEffectsApi({ effects: [effect], master: [] }, kit);
  const view = render(GeneratorCard, { props: { api, effect: api.effectById('e1')! } });
  const rerender = () => view.rerender({ api, effect: api.effectById('e1')! });
  return { api, view, rerender, p: () => api.effectById('e1')!.generator.params };
}
const section = (v: ReturnType<typeof setup>['view'], name: string) => within(v.getByRole('region', { name }));

describe('Splice card sections', () => {
  it('lays out SPLICE · MOVE AROUND · MOVE THROUGH · BRIGHTNESS ENVELOPE in the inspector’s words', () => {
    const { view } = setup();
    for (const name of ['Splice', 'Move around', 'Move through', 'Brightness envelope']) expect(view.getByRole('region', { name })).toBeTruthy();
    const splice = section(view, 'Splice');
    for (const label of ['Splices', 'Per', 'Rotate', 'Random lengths', 'Smudge']) expect(splice.getByText(label)).toBeTruthy();
    expect(splice.queryByText('Seed')).toBeNull(); // only once lengths are random
    const env = section(view, 'Brightness envelope');
    for (const label of ['Attack', 'Curve', 'Sustain', 'Decay']) expect(env.getByText(label)).toBeTruthy();
  });

  it('Seed appears with Random lengths', () => {
    const { view } = setup({ jitter: 0.3 });
    expect(section(view, 'Splice').getByText('Seed')).toBeTruthy();
  });

  it('Motion off hides the rest of MOVE AROUND; Chase shows On each hit, Rate and Direction', async () => {
    const { view, api, p, rerender } = setup();
    expect(section(view, 'Move around').queryByText('Rate')).toBeNull();
    await fireEvent.click(section(view, 'Move around').getByRole('radio', { name: 'Chase' }));
    expect(p().chase).toBe('step');
    await rerender();
    const around = section(view, 'Move around');
    for (const label of ['On each hit', 'Rate', 'Direction']) expect(around.getByText(label)).toBeTruthy();
    await fireEvent.click(around.getByRole('radio', { name: 'Reverse' }));
    expect(p().direction).toBe(-1);
    expect(api.undoDepth).toBe(2);
  });

  it('MOVE THROUGH: a kit-wide cut offers THROUGH KIT and THROUGH DRUM; AROUND only once waiting parts go dark', async () => {
    const { view, rerender, api } = setup();
    const through = () => section(view, 'Move through');
    expect(through().getByText('THROUGH KIT')).toBeTruthy();
    expect(through().getByText('THROUGH DRUM')).toBeTruthy();
    expect(through().queryByText('AROUND HOOP')).toBeNull();
    await fireEvent.click(through().getByRole('radio', { name: 'Dark' }));
    await rerender();
    expect(through().getByText('AROUND HOOP')).toBeTruthy();
    expect(api.undoDepth).toBe(1);
  });

  it('a struck-drum Target has no THROUGH KIT (one drum: nowhere to send it)', () => {
    const { view } = setup({}, { kind: 'hitDrum' });
    expect(section(view, 'Move through').queryByText('THROUGH KIT')).toBeNull();
  });

  it('an active cascade shows its Order; a pattern replaces a dragged order in one step', async () => {
    const { view, p, api } = setup({ drumOffsetDivision: '1/8', drumSequence: 'snare,kick' });
    const through = section(view, 'Move through');
    expect(through.getByRole('list', { name: 'Through kit order' }).textContent).toMatch(/Snare.*Kick/);
    await fireEvent.click(through.getByRole('radio', { name: 'Down' }));
    expect(p().drumOrder).toBe('down');
    expect(p().drumSequence).toBe('');
    expect(api.undoDepth).toBe(1);
  });
});
