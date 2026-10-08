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
/** A labelled field's wrapper, and whether it is dimmed (it doesn't apply in this mode). */
const fieldOf = (scope: ReturnType<typeof within>, label: string) => scope.getByText(label, { selector: '.flabel, .label, span' }).closest('.field, li')!;
const dimmed = (scope: ReturnType<typeof within>, label: string) => fieldOf(scope, label).classList.contains('inactive');
const sectionNames = (v: ReturnType<typeof setup>['view']) => v.getAllByRole('region').map((r) => r.getAttribute('aria-label'));

// The Generator standard (docs/design/generator-standard.md; Tim, 2026-10-07): FORM, (START), SHAPE,
// MOVEMENT with Around / Through sub-headings, TIMING, COLOUR — and a setting that doesn't apply is
// dimmed in place, never hidden, so the card never moves.
describe('Splice card sections', () => {
  it('lays out SPLICES · SHAPE · MOVEMENT · TIMING · COLOUR, in the standard order — no envelope, no Velocity', () => {
    const { view } = setup();
    expect(sectionNames(view).filter((n) => ['Splices', 'Shape', 'Movement', 'Timing', 'Colour'].includes(n!))).toEqual(['Splices', 'Shape', 'Movement', 'Timing', 'Colour']);
    expect(view.queryByRole('region', { name: 'Brightness envelope' })).toBeNull();
    expect(view.queryByText('Velocity')).toBeNull();
    const form = section(view, 'Splices');
    for (const label of ['Splices', 'Per', 'Random', 'Seed']) expect(form.getAllByText(label).length).toBeGreaterThan(0);
    for (const label of ['Rotate', 'Smudge']) expect(section(view, 'Shape').getByText(label)).toBeTruthy();
    const movement = section(view, 'Movement');
    for (const sub of ['Around', 'Through']) expect(movement.getByRole('heading', { name: sub })).toBeTruthy();
    // The bands live under COLOUR — order, colour box and each one's Generator (Tim, 2026-10-07).
    const colour = section(view, 'Colour');
    expect(colour.getByRole('region', { name: 'Splice bands' })).toBeTruthy();
    expect(colour.getByLabelText('Splice 1 colour')).toBeTruthy();
    expect(colour.getByRole('button', { name: 'Splice 1 generator' })).toBeTruthy();
  });

  it('Seed is there all along, dimmed until lengths are Random', () => {
    expect(dimmed(section(setup().view, 'Splices'), 'Seed')).toBe(true);
  });

  it('Random lengths light Seed', () => {
    expect(dimmed(section(setup({ jitter: 0.3 }).view, 'Splices'), 'Seed')).toBe(false);
  });

  it('Motion off dims Rate, Direction and On each hit in place; Chase lights them', async () => {
    const { view, api, p, rerender } = setup();
    const movement = () => section(view, 'Movement');
    expect(dimmed(movement(), 'Rate')).toBe(true);
    expect(dimmed(movement(), 'Direction')).toBe(true);
    expect(dimmed(section(view, 'Timing'), 'On each hit')).toBe(true);
    await fireEvent.click(movement().getByRole('radio', { name: 'Chase' }));
    expect(p().chase).toBe('step');
    await rerender();
    expect(dimmed(movement(), 'Rate')).toBe(false);
    expect(dimmed(section(view, 'Timing'), 'On each hit')).toBe(false);
    await fireEvent.click(movement().getByRole('radio', { name: 'Reverse' }));
    expect(p().direction).toBe(-1);
    expect(api.undoDepth).toBe(2);
  });

  it('Through: kit, drum and around-hoop always shown; around-hoop lights once waiting parts go dark', async () => {
    const { view, rerender, api } = setup();
    const movement = () => section(view, 'Movement');
    expect(dimmed(movement(), 'Through kit')).toBe(false);
    expect(dimmed(movement(), 'Through drum')).toBe(false);
    expect(dimmed(movement(), 'Around hoop')).toBe(true);
    await fireEvent.click(section(view, 'Timing').getByRole('radio', { name: 'Dark' }));
    await rerender();
    expect(dimmed(movement(), 'Around hoop')).toBe(false);
    expect(api.undoDepth).toBe(1);
  });

  it('a struck-drum Target dims Through kit (one drum: nowhere to send it)', () => {
    expect(dimmed(section(setup({}, { kind: 'hitDrum' }).view, 'Movement'), 'Through kit')).toBe(true);
  });

  it('an active cascade lights its Order; a pattern replaces a dragged order in one step', async () => {
    const { view, p, api } = setup({ drumOffsetDivision: '1/8', drumSequence: 'snare,kick' });
    const movement = section(view, 'Movement');
    expect(movement.getByRole('list', { name: 'Through kit order' }).textContent).toMatch(/Snare.*Kick/);
    await fireEvent.click(movement.getAllByRole('radio', { name: 'Down' })[0]!);
    expect(p().drumOrder).toBe('down');
    expect(p().drumSequence).toBe('');
    expect(api.undoDepth).toBe(1);
  });

  it('every band\'s colour is under COLOUR', async () => {
    const effect = effectChain.parseEffect({ id: 'e1', cell, generator: { kind: 'splice', params: { count: 2 }, slots: [{ color: '#ff0000' }, {}] } });
    const api = createStandaloneEffectsApi({ effects: [effect], master: [] }, kit);
    const view = render(GeneratorCard, { props: { api, effect: api.effectById('e1')! } });
    expect(section(view, 'Colour').getByLabelText('Splice 1 colour')).toBeTruthy();
    expect(section(view, 'Colour').getByLabelText('Splice 2 colour')).toBeTruthy();
    // Tint acts once a band has a colour AND a Generator: none has one here.
    expect(dimmed(section(view, 'Colour'), 'Tint')).toBe(true);
  });
});

describe('Slice card sections', () => {
  function slice(params: Record<string, unknown> = {}, target: unknown = { kind: 'kit' }) {
    const effect = effectChain.parseEffect({ id: 'e1', name: 'Cut', cell, target, generator: { kind: 'slice', params } });
    const api = createStandaloneEffectsApi({ effects: [effect], master: [] }, kit);
    const view = render(GeneratorCard, { props: { api, effect: api.effectById('e1')! } });
    const rerender = () => view.rerender({ api, effect: api.effectById('e1')! });
    return { api, view, rerender, e: () => api.effectById('e1')! };
  }

  it('lays out SLICES · START · SHAPE · MOVEMENT · TIMING · COLOUR — Velocity is the Velocity Control\'s', () => {
    const { view } = slice();
    expect(sectionNames(view).filter((n) => ['Slices', 'Start', 'Shape', 'Movement', 'Timing', 'Colour'].includes(n!))).toEqual(['Slices', 'Start', 'Shape', 'Movement', 'Timing', 'Colour']);
    expect(section(view, 'Start').getByText('On')).toBeTruthy();
    for (const label of ['Axis', 'Tilt (°)', 'Smudge']) expect(section(view, 'Shape').getByText(label)).toBeTruthy();
    expect(section(view, 'Movement').getByRole('radio', { name: 'Sweep' })).toBeTruthy();
    expect(view.queryByText('Velocity')).toBeNull();
  });

  it('On writes the Target: Drum → the struck drum; Space → the kit plus a box — Drum and the box dim in place otherwise', async () => {
    const { view, e, rerender, api } = slice();
    const start = () => section(view, 'Start');
    expect(dimmed(start(), 'Drum')).toBe(true);
    expect(dimmed(start(), 'Centre (mm)')).toBe(true);
    await fireEvent.click(start().getByRole('radio', { name: 'Drum' }));
    expect(e().target).toEqual({ kind: 'hitDrum' });
    expect(api.undoDepth).toBe(1);
    await rerender();
    expect(dimmed(start(), 'Drum')).toBe(false);
    expect(dimmed(section(view, 'Movement'), 'Through kit')).toBe(true); // one drum: nowhere to send it
    await fireEvent.click(start().getByRole('radio', { name: 'Space' }));
    expect(e().target).toEqual({ kind: 'kit' });
    expect(typeof e().generator.params.regionSx).toBe('number');
    await rerender();
    expect(dimmed(start(), 'Centre (mm)')).toBe(false);
    expect(start().getByLabelText('Slice region centre X')).toBeTruthy();
    await fireEvent.click(start().getByRole('radio', { name: 'Kit' }));
    expect(e().generator.params.regionSx).toBeUndefined(); // leaving Space removes the box
  });

  it('Through kit and Through slices under MOVEMENT; the colour chase under COLOUR, lit once waiting parts go dark', async () => {
    const { view, rerender } = slice();
    expect(section(view, 'Movement').getByText('Through kit')).toBeTruthy();
    expect(section(view, 'Movement').getByText('Through slices')).toBeTruthy();
    expect(dimmed(section(view, 'Colour'), 'Colour chase')).toBe(true);
    await fireEvent.click(section(view, 'Timing').getByRole('radio', { name: 'Fade' }));
    await rerender();
    expect(dimmed(section(view, 'Colour'), 'Colour chase')).toBe(false);
  });
});
