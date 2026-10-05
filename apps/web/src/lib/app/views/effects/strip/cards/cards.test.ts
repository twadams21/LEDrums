// @vitest-environment jsdom
/* The device cards against a real authoring api (the in-memory standalone host): every edit a
   card offers must land in the section as ONE undo step, a drag must fold into one, a viewer
   must not author, and the modulated badge must follow the mappings. */
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import { MASTER_CELL } from '../../../../../trigger-lab/effects-api';
import { createStandaloneEffectsApi } from '../../../../../trigger-lab/effects-controller.svelte';
import GeneratorCard from './GeneratorCard.svelte';
import ModifierCard from './ModifierCard.svelte';
import ControlCard from './ControlCard.svelte';
import TriggerCard from '../TriggerCard.svelte';
import ParamRows from './ParamRows.svelte';

beforeAll(() => {
  // jsdom has no IntersectionObserver / canvas; the live thumbnail needs neither to mount.
  globalThis.IntersectionObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof IntersectionObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const kit: KitConfig = { ...DEFAULT_KIT, drums: [{ ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' }] };
const cell = { row: 'kick', column: { kind: 'zone' as const, slot: 0 } };

function demo(extra: Record<string, unknown> = {}, opts: { canEdit?: boolean } = {}) {
  const effect = effectChain.parseEffect({ id: 'e1', name: 'Pulse', cell, generator: { kind: 'wave', style: 'radial' }, ...extra });
  const api = createStandaloneEffectsApi({ effects: [effect], master: [] }, kit, opts);
  return { api, effect: () => api.effectById('e1')! };
}

describe('GeneratorCard', () => {
  it('a long param list runs in columns of at most 12 rows; a Wave card stays portrait', () => {
    const many = Array.from({ length: 22 }, (_, k) => ({ key: `p${k}`, label: `P${k}`, kind: 'number' as const, min: 0, max: 1, step: 0.01, default: 0 }));
    const rows = render(ParamRows, { props: { params: many, values: {}, onChange: () => {} } }).container.querySelector<HTMLElement>('.rows')!;
    expect(rows.classList.contains('cols')).toBe(true);
    expect(rows.style.getPropertyValue('--param-rows')).toBe('11'); // two columns of 11
    const wave = demo();
    const portrait = render(GeneratorCard, { props: { api: wave.api, effect: wave.effect() } });
    expect(portrait.container.querySelector('.card')!.classList.contains('landscape')).toBe(false);
  });

  it('sectioned params get capitalised headers, short sections sharing a column', () => {
    const p = (key: string, section: string) => ({ key, label: key, kind: 'number' as const, min: 0, max: 1, default: 0, section });
    const params = [p('a', 'Dots'), p('b', 'Dots'), p('c', 'Shape')];
    const { container } = render(ParamRows, { props: { params, values: {}, onChange: () => {} } });
    expect([...container.querySelectorAll('.sectitle')].map((h) => h.textContent)).toEqual(['Dots', 'Shape']);
    expect(container.querySelectorAll('.scol')).toHaveLength(1);
    expect(container.querySelector('section[aria-label="Shape"] .rows')!.children).toHaveLength(1);
  });

  it('the controller every Effects mount gets knows the kit — hoops, pixels, plan (Tim, 2026-10-05: Start hoop showed 8 buttons)', () => {
    const { api } = demo();
    const kit = api as unknown as { drumHoopCount(id: string): number; hoopPixelCount(id: string, h: number): number; kitPlan(): { drums: unknown[] } };
    expect(kit.drumHoopCount('kick')).toBeGreaterThan(0);
    expect(kit.hoopPixelCount('kick', 1)).toBeGreaterThan(0);
    expect(kit.kitPlan().drums.length).toBe(api.gridRows.length - 1);
  });

  it('a Dot\'s Start angle is a ring of the hoop\'s pixels — no number — stepped with the arrows', async () => {
    const { api, effect } = demo();
    api.setGenerator(effect().id, 'dot');
    const { container } = render(GeneratorCard, { props: { api, effect: effect() } });
    const ring = container.querySelector<SVGElement>('svg.ring[role="slider"]')!;
    expect(ring).toBeTruthy();
    expect(ring.getAttribute('aria-valuetext')).toBe('the front');
    expect(container.querySelector('svg.ring text.num')).toBeNull();
    await fireEvent.keyDown(ring, { key: 'ArrowRight' });
    expect(Number(effect().generator.params.startAngle)).toBeGreaterThan(0);
    // Start hoop: a button per hoop of the drum.
    expect(container.querySelectorAll('.row.pick [role="radio"], .row.pick button').length).toBeGreaterThan(0);
  });

  it('swaps the Generator from the kind picker in one undo step, keeping the modifiers', async () => {
    const { api, effect } = demo({ modifiers: [{ uid: 'm1', modifierId: 'strobe' }] });
    const { getByRole } = render(GeneratorCard, { props: { api, effect: effect() } });
    await fireEvent.click(getByRole('button', { name: 'Noise' }));
    expect(effect().generator.kind).toBe('noise');
    expect(effect().modifiers.map((m) => m.uid)).toEqual(['m1']);
    expect(api.undoDepth).toBe(1);
  });

  it('moves focus through the kinds with the arrows without authoring', async () => {
    const { api, effect } = demo();
    const { getByRole } = render(GeneratorCard, { props: { api, effect: effect() } });
    const wave = getByRole('button', { name: 'Wave' });
    expect(wave.getAttribute('aria-pressed')).toBe('true');
    wave.focus();
    await fireEvent.keyDown(wave, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(getByRole('button', { name: 'Noise' }));
    expect(api.undoDepth).toBe(0);
    expect(effect().generator.kind).toBe('wave');
  });

  it('edits a Style param from its face control', async () => {
    const { api, effect } = demo();
    const spec = effectChain.generatorParamSpec('wave', 'radial').find((s) => s.type === 'number' && s.min !== undefined && s.max !== undefined)!;
    const { getByRole } = render(GeneratorCard, { props: { api, effect: effect() } });
    const slider = getByRole('slider', { name: `Wave ${spec.label}` });
    await fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(effect().generator.params[spec.key]).not.toBeUndefined();
    expect(effect().generator.params[spec.key]).not.toBe(spec.default);
    expect(api.undoDepth).toBe(1);
  });

  it('badges a param a control drives', () => {
    const spec = effectChain.generatorParamSpec('wave', 'radial').find((s) => s.type === 'number')!;
    const { api, effect } = demo({ controls: [{ uid: 'c1', kind: 'lfo', mappings: [{ device: 'generator', param: spec.key }] }] });
    const { container } = render(GeneratorCard, { props: { api, effect: effect() } });
    expect(container.querySelectorAll('.modbadge').length).toBe(1);
  });

  it('is inert for a viewer', () => {
    const { api, effect } = demo({}, { canEdit: false });
    const { getByRole } = render(GeneratorCard, { props: { api, effect: effect() } });
    expect((getByRole('button', { name: 'Noise' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows one Splices row per band (Count), and Add appends after them, raising Count — one undo step', async () => {
    const { api, effect } = demo({ generator: { kind: 'splice', slots: [{ color: '#ff0000' }, { color: '#0000ff' }] } });
    const { getByRole, container } = render(GeneratorCard, { props: { api, effect: effect() } });
    expect(container.querySelector('.preview')).toBeNull(); // a splice previews through its slots
    expect(container.querySelectorAll('.slot')).toHaveLength(4); // Count 4: the two authored, cycling
    await fireEvent.click(getByRole('button', { name: 'Add splice' }));
    expect(effect().generator.slots!.map((s) => s.color)).toEqual(['#ff0000', '#0000ff', '#ff0000', '#0000ff', '#0000ff']);
    expect(effect().generator.params.count).toBe(5);
    expect(api.undoDepth).toBe(1);
  });

  it('mutes a slot from its power toggle', async () => {
    const { api, effect } = demo({ generator: { kind: 'splice', slots: [{ color: '#ff0000' }, { color: '#00ff00' }] } });
    const { getByRole } = render(GeneratorCard, { props: { api, effect: effect() } });
    await fireEvent.click(getByRole('button', { name: 'Splice 2 on' }));
    expect(effect().generator.slots![1]!.muted).toBe(true);
    expect(effect().generator.slots![0]!.muted).toBeUndefined();
  });
});

describe('ModifierCard', () => {
  it('a ms / Hz param switches to beats and back — the value it does at 120 bpm is kept — one undo step each', async () => {
    const { api, effect } = demo({ modifiers: [{ uid: 'm1', modifierId: 'echo', params: { delayMs: 250 } }] });
    const view = render(ModifierCard, { props: { api, effectId: 'e1', modifier: effect().modifiers[0]! } });
    const toggle = view.getByRole('button', { name: /Echo Delay: in ms/ });
    await fireEvent.click(toggle);
    expect(effect().modifiers[0]!.params['delayMs:beats']).toBe(0.5); // 250 ms = 1/8 at 120 bpm
    await view.rerender({ api, effectId: 'e1', modifier: effect().modifiers[0]! });
    expect(view.getByRole('slider', { name: 'Echo Delay beats' }).textContent).toContain('1/8');
    await fireEvent.click(view.getByRole('button', { name: /Echo Delay: in beats/ }));
    expect(effect().modifiers[0]!.params['delayMs:beats']).toBeUndefined();
    expect(effect().modifiers[0]!.params.delayMs).toBe(250);
    expect(api.undoDepth).toBe(2);
  });

  it('Strobe’s Frequency has no switch of its own — its Rate dropdown already does beats', () => {
    const { api, effect } = demo({ modifiers: [{ uid: 'm1', modifierId: 'strobe' }] });
    const view = render(ModifierCard, { props: { api, effectId: 'e1', modifier: effect().modifiers[0]! } });
    expect(view.queryByRole('button', { name: /Strobe Frequency: in/ })).toBeNull();
  });

  const withStrobe = () => demo({ modifiers: [{ uid: 'm1', modifierId: 'strobe' }] });

  it('Strobe’s Rate is one dropdown — Free (Hz) shows the Hz row; a division hides it — one undo step', async () => {
    const { api, effect } = withStrobe();
    const view = render(ModifierCard, { props: { api, effectId: 'e1', modifier: effect().modifiers[0]! } });
    const rate = view.getByRole('button', { name: 'Strobe rate' });
    expect(rate.textContent).toContain('Free (Hz)');
    expect(view.getByRole('slider', { name: 'Strobe Frequency' })).toBeTruthy(); // the Hz value
    await fireEvent.keyDown(rate, { key: 'Enter' });
    await fireEvent.pointerUp(view.getByRole('option', { name: '1/8' }), { pointerType: 'mouse' });
    expect(effect().modifiers[0]!.params).toMatchObject({ rateMode: 'beats', division: '1/8' });
    expect(api.undoDepth).toBe(1);
    await view.rerender({ api, effectId: 'e1', modifier: effect().modifiers[0]! });
    expect(view.queryByRole('slider', { name: 'Strobe Frequency' })).toBeNull(); // no Hz in a division
  });

  it('bypasses from the power toggle', async () => {
    const { api, effect } = withStrobe();
    const { getByRole } = render(ModifierCard, { props: { api, effectId: 'e1', modifier: effect().modifiers[0]! } });
    await fireEvent.click(getByRole('button', { name: 'Strobe on' }));
    expect(effect().modifiers[0]!.bypass).toBe(true);
  });

  it('nudges Mix from the keyboard', async () => {
    const { api, effect } = withStrobe();
    const { getByRole } = render(ModifierCard, { props: { api, effectId: 'e1', modifier: effect().modifiers[0]! } });
    await fireEvent.keyDown(getByRole('slider', { name: 'Strobe mix' }), { key: 'ArrowLeft' });
    expect(effect().modifiers[0]!.mix).toBeLessThan(1);
    expect(api.undoDepth).toBe(1);
  });

  it('keeps the envelope collapsed until asked, and switching it on adds one', async () => {
    const { api, effect } = withStrobe();
    const { getByRole, queryByRole } = render(ModifierCard, { props: { api, effectId: 'e1', modifier: effect().modifiers[0]! } });
    expect(queryByRole('slider', { name: 'Strobe envelope Attack' })).toBeNull();
    await fireEvent.click(getByRole('switch', { name: 'Strobe envelope on' }));
    expect(effect().modifiers[0]!.envelope).toBeDefined();
  });

  it('folds a whole param drag into one undo step', async () => {
    const { api, effect } = withStrobe();
    const { getByRole } = render(ModifierCard, { props: { api, effectId: 'e1', modifier: effect().modifiers[0]! } });
    const mix = getByRole('slider', { name: 'Strobe mix' });
    mix.setPointerCapture = () => {};
    await fireEvent.pointerDown(mix, { button: 0, clientX: 100, pointerId: 1 });
    await fireEvent.pointerMove(mix, { clientX: 60, pointerId: 1 });
    await fireEvent.pointerMove(mix, { clientX: 20, pointerId: 1 });
    await fireEvent.pointerUp(mix, { pointerId: 1 });
    expect(effect().modifiers[0]!.mix).toBeLessThan(1);
    expect(api.undoDepth).toBe(1);
  });

  it('edits the Master chain when addressed by MASTER_CELL', async () => {
    const api = createStandaloneEffectsApi({ effects: [], master: [effectChain.modifierDeviceSchema.parse({ uid: 'mm', modifierId: 'strobe' })] }, kit);
    const { getByRole } = render(ModifierCard, { props: { api, effectId: MASTER_CELL, modifier: api.masterChain[0]! } });
    await fireEvent.click(getByRole('button', { name: 'Strobe on' }));
    expect(api.masterChain[0]!.bypass).toBe(true);
  });
});

describe('ControlCard', () => {
  const withLfo = (mappings: unknown[] = [{ device: 'generator', param: 'speed' }]) =>
    demo({ controls: [{ uid: 'c1', kind: 'lfo', mappings }] });

  it('inverts and removes a mapping', async () => {
    const { api, effect } = withLfo();
    const { getByRole } = render(ControlCard, { props: { api, effect: effect(), control: effect().controls[0]! } });
    await fireEvent.click(getByRole('button', { name: 'Invert mapping' }));
    expect(effect().controls[0]!.mappings[0]!.invert).toBe(true);
    await fireEvent.click(getByRole('button', { name: 'Remove mapping' }));
    expect(effect().controls[0]!.mappings).toEqual([]);
  });

  it('edits the mapping amount', async () => {
    const { api, effect } = withLfo();
    const { getByRole } = render(ControlCard, { props: { api, effect: effect(), control: effect().controls[0]! } });
    await fireEvent.keyDown(getByRole('slider', { name: 'Mapping amount' }), { key: 'ArrowLeft' });
    expect(effect().controls[0]!.mappings[0]!.amount).toBeLessThan(1);
  });

  it('flags a mapping whose device is no longer in the Effect', () => {
    const { api, effect } = withLfo([{ device: 'gone', param: 'rate' }]);
    const { getByText } = render(ControlCard, { props: { api, effect: effect(), control: effect().controls[0]! } });
    expect(getByText('Missing · rate')).toBeTruthy();
  });

  it('one Rate dropdown: Free (Hz) shows the Frequency row, a division hides it — one undo step', async () => {
    const { api, effect } = withLfo([]);
    const view = render(ControlCard, { props: { api, effect: effect(), control: effect().controls[0]! } });
    expect(view.getByRole('button', { name: 'LFO rate' }).textContent).toContain('Free (Hz)');
    expect(view.queryByRole('slider', { name: 'LFO Frequency' })).not.toBeNull();
    await fireEvent.keyDown(view.getByRole('button', { name: 'LFO rate' }), { key: 'Enter' });
    await fireEvent.pointerUp(view.getByRole('option', { name: '1/8' }), { pointerType: 'mouse' });
    expect(effect().controls[0]!.settings).toMatchObject({ rateMode: 'beats', division: '1/8' });
    expect(api.undoDepth).toBe(1);
    const again = render(ControlCard, { props: { api, effect: effect(), control: effect().controls[0]! } });
    expect(again.container.querySelector('[aria-label="LFO Frequency"][role="slider"]')).toBeNull();
  });
});

describe('highlighting a card (the thing Delete / ⌘X / ⌘C act on)', () => {
  it('a press anywhere on a Modifier card highlights that Modifier', async () => {
    const { api } = demo({ modifiers: [{ uid: 'm1', modifierId: 'strobe' }] });
    const modifier = api.effectById('e1')!.modifiers[0]!;
    const { container, rerender } = render(ModifierCard, { props: { api, effectId: 'e1', modifier } });
    await fireEvent.pointerDown(container.querySelector('section.card')!);
    expect(api.selectedDevice).toEqual({ kind: 'modifier', owner: 'e1', uid: 'm1' });
    await rerender({ api, effectId: 'e1', modifier });
    expect(container.querySelector('section.card')!.classList.contains('selected')).toBe(true);
  });

  it('a press on the Generator highlights the Generator alone — not the Trigger beside it', async () => {
    // Tim, 2026-10-01: clicking Wave also lit the Trigger, when he only wanted Wave.
    const { api, effect } = demo();
    const gen = render(GeneratorCard, { props: { api, effect: effect() } });
    await fireEvent.pointerDown(gen.container.querySelector('section.card')!);
    expect(api.selectedDevice).toEqual({ kind: 'stage', effectId: 'e1', stage: 'generator' });
    const trigger = render(TriggerCard, { props: { api, effect: effect() } });
    expect(trigger.container.querySelector('section.device')!.classList.contains('selected')).toBe(false);
    await gen.rerender({ api, effect: effect() });
    expect(gen.container.querySelector('section.card')!.classList.contains('selected')).toBe(true);
  });
});
