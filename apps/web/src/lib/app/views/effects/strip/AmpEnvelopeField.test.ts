// @vitest-environment jsdom
/* The brightness envelope on the Trigger card (Tim, 2026-10-01): Attack · Curve · Sustain · Decay
   in place of the ADSR, against the real in-memory authoring api. */
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { DEFAULT_KIT, effectChain, type KitConfig } from '@ledrums/core';
import { createStandaloneEffectsApi } from '../../../../trigger-lab/effects-controller.svelte';
import AmpEnvelopeField from './AmpEnvelopeField.svelte';
import { ampPath, beatsLabel, stageUnitPatch } from './strip-model';

const kit: KitConfig = { ...DEFAULT_KIT, drums: [{ ...DEFAULT_KIT.drums[0]!, id: 'kick', label: 'Kick' }] };
const cell = { row: 'kick', column: { kind: 'zone' as const, slot: 0 } };

function setup(amp: Record<string, unknown> = {}) {
  const effect = effectChain.parseEffect({ id: 'e1', name: 'Hit', cell, generator: { kind: 'solid' }, amp });
  const api = createStandaloneEffectsApi({ effects: [effect], master: [] }, kit);
  const view = render(AmpEnvelopeField, { props: { api, effect: api.effectById('e1')! } });
  return { api, view, amp: () => api.effectById('e1')!.amp };
}

describe('the brightness envelope', () => {
  it('reads Attack · Curve · Sustain · Decay — no ADSR drop on a new Effect', () => {
    const { view } = setup();
    for (const label of ['Attack', 'Curve', 'Sustain', 'Decay']) expect(view.getByText(label)).toBeTruthy();
    expect(view.queryByText('Drop')).toBeNull();
    expect(view.getByRole('button', { name: 'Sustain' }).textContent).toContain('Time');
  });

  it('shows the old ADSR drop only on an Effect that still uses one, so it plays as it did', () => {
    const { view } = setup({ decayMs: 120, sustainLevel: 0.4 });
    expect(view.getByText('Drop')).toBeTruthy();
    expect(view.getByText('Drop to')).toBeTruthy();
  });

  it('picking a curve writes it, one undo step; back to Linear removes it', async () => {
    const { view, api, amp } = setup();
    await fireEvent.keyDown(view.getByRole('button', { name: 'Attack curve — family' }), { key: 'Enter' });
    await fireEvent.pointerUp(view.getByRole('option', { name: /Quad/ }), { pointerType: 'mouse' });
    expect(amp().attackEase?.fn).toBe('quad');
    expect(api.undoDepth).toBe(1);
    api.setAmp('e1', { attackEase: undefined }); // what picking Linear sends
    expect(amp().attackEase).toBeUndefined();
  });

  it('the outline bends on an eased attack and stays a straight ramp on a linear one', () => {
    const base = effectChain.parseEffect({ id: 'x', cell, generator: { kind: 'solid' } }).amp;
    const straight = ampPath(base, 200, 24);
    const eased = ampPath({ ...base, attackEase: { fn: 'quad', dir: 'in' } }, 200, 24);
    expect(straight.split('L').length).toBeLessThan(eased.split('L').length);
  });
});

describe('Attack and Decay in ms or beats (Tim, 2026-10-02)', () => {
  it('switching a stage to beats keeps its length (at 120 bpm), as a clean division; back to ms restores ms', () => {
    const amp = effectChain.parseEffect({ id: 'x', cell, generator: { kind: 'solid' }, amp: { attackMs: 250, releaseMs: 300 } }).amp;
    expect(stageUnitPatch('attack', 'beats', amp)).toEqual({ attackBeats: 0.5 });
    expect(stageUnitPatch('release', 'beats', amp)).toEqual({ releaseBeats: 0.625 });
    expect(stageUnitPatch('attack', 'ms', { ...amp, attackBeats: 1 })).toEqual({ attackMs: 500, attackBeats: undefined });
    expect(stageUnitPatch('attack', 'ms', amp)).toEqual({}); // already ms
  });

  it('a beat count reads as a division where it is one', () => {
    expect([beatsLabel(0.25), beatsLabel(0.5), beatsLabel(0.75), beatsLabel(1 / 3), beatsLabel(2)]).toEqual(['1/16', '1/8', '1/8.', '1/8t', '2 bt']);
  });

  it('the card shows a unit for Attack and Decay, and a beats stage reads as a division', async () => {
    const { view, api, amp } = setup({ attackMs: 250 });
    expect(view.getByRole('button', { name: 'Attack unit' }).textContent).toContain('ms');
    await fireEvent.keyDown(view.getByRole('button', { name: 'Attack unit' }), { key: 'Enter' });
    await fireEvent.pointerUp(view.getByRole('option', { name: 'Beats' }), { pointerType: 'mouse' });
    expect(amp().attackBeats).toBe(0.5);
    expect(api.undoDepth).toBe(1);
  });
});
