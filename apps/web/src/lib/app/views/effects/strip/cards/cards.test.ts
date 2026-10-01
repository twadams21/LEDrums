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
  it('a Splice (many params) goes landscape: params in columns of at most 10 rows; a Wave stays portrait', () => {
    const splice = demo({ generator: { kind: 'splice' } });
    const { container } = render(GeneratorCard, { props: { api: splice.api, effect: splice.effect() } });
    const card = container.querySelector('.card')!;
    expect(card.classList.contains('landscape')).toBe(true);
    const rows = card.querySelector<HTMLElement>('.rows')!;
    expect(rows.classList.contains('cols')).toBe(true);
    const count = rows.querySelectorAll('.row').length;
    expect(Number(rows.style.getPropertyValue('--param-rows'))).toBeLessThanOrEqual(10);
    expect(Number(rows.style.getPropertyValue('--param-rows'))).toBe(Math.ceil(count / Math.ceil(count / 10)));
    const wave = demo();
    const portrait = render(GeneratorCard, { props: { api: wave.api, effect: wave.effect() } });
    expect(portrait.container.querySelector('.card')!.classList.contains('landscape')).toBe(false);
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

  it('shows the slots editor for a Splice and appends a coloured slot', async () => {
    const { api, effect } = demo({ generator: { kind: 'splice', slots: [{ color: '#ff0000' }] } });
    const { getByRole, container } = render(GeneratorCard, { props: { api, effect: effect() } });
    expect(container.querySelector('.preview')).toBeNull(); // a splice previews through its slots
    await fireEvent.click(getByRole('button', { name: 'Add splice' }));
    expect(effect().generator.slots).toHaveLength(2);
    expect(typeof effect().generator.slots![1]!.color).toBe('string');
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
  const withStrobe = () => demo({ modifiers: [{ uid: 'm1', modifierId: 'strobe' }] });

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

  it('shows the Hz rate only in Hz mode', () => {
    const { api, effect } = withLfo([]);
    const { queryByRole } = render(ControlCard, { props: { api, effect: effect(), control: effect().controls[0]! } });
    expect(queryByRole('slider', { name: 'LFO Rate' })).not.toBeNull();
    api.setControlSettings('e1', 'c1', { rateMode: 'beats' });
    const again = render(ControlCard, { props: { api, effect: effect(), control: effect().controls[0]! } });
    expect(again.container.querySelector('[aria-label="LFO Rate"][role="slider"]')).toBeNull();
  });
});
