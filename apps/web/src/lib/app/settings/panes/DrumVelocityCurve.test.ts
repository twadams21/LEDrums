// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { IDENTITY_CURVE, type CurveValue, type InputMap } from '@ledrums/core';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import DrumVelocityCurve from './DrumVelocityCurve.svelte';

/* Locks the per-DRUM velocity editor's contract with the model: it reads the drum's own
   curve (absent = linear), writes through the ONE `setInputMap` gate, resets by DELETING
   the curve, and feeds the plot the store's live hits. The curve maths and the gestures are
   `curve-field.test.ts`'s, not re-tested here. */

beforeAll(() => {
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

const LIFT: CurveValue = { h0: { x: 0.2, y: 0 }, h1: { x: 0.9, y: 1 }, profile: 'bend', strength: 0.6 };

const inputMap = (velocityCurves: Record<string, CurveValue> = {}): InputMap =>
  ({ midiNotes: [], midiChannel: null, oscMap: [], zones: [], globalControls: {}, velocityCurves }) as unknown as InputMap;

function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    project: { inputMap: inputMap(), kit: { drums: [{ id: 'kick', label: 'Kick' }] } },
    canEdit: true,
    velocityHitsFor: () => [],
    setInputMap: vi.fn(() => true),
    ...over,
  } as unknown as TriggerLab;
}

const props = (store: TriggerLab) => ({ store, drumId: 'kick', drumLabel: 'Kick' });

describe('DrumVelocityCurve', () => {
  it('reads linear for a drum with no curve — absent IS the identity', () => {
    render(DrumVelocityCurve, { props: props(mockStore()) });
    expect(screen.getByText('linear')).toBeTruthy();
    expect(screen.queryByText('custom')).toBeNull();
  });

  it('reads custom once the drum carries a real curve', () => {
    const store = mockStore({ project: { inputMap: inputMap({ kick: LIFT }), kit: { drums: [] } } });
    render(DrumVelocityCurve, { props: props(store) });
    expect(screen.getByText('custom')).toBeTruthy();
  });

  it('reads only ITS OWN drum’s curve', () => {
    const store = mockStore({ project: { inputMap: inputMap({ snare: LIFT }), kit: { drums: [] } } });
    render(DrumVelocityCurve, { props: props(store) });
    expect(screen.getByText('linear')).toBeTruthy();
  });

  it('names the drum on the plot, where no card supplies the context', () => {
    render(DrumVelocityCurve, { props: props(mockStore()) });
    expect(screen.getByLabelText('Velocity sensitivity — Kick')).toBeTruthy();
  });

  it('resets by DELETING the curve, through setInputMap', async () => {
    const store = mockStore({ project: { inputMap: inputMap({ kick: LIFT, snare: LIFT }), kit: { drums: [] } } });
    render(DrumVelocityCurve, { props: props(store) });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset to linear' }));
    expect(store.setInputMap).toHaveBeenCalledTimes(1);
    const written = vi.mocked(store.setInputMap).mock.calls[0]![0];
    expect(written.velocityCurves).toEqual({ snare: LIFT });
  });

  it('offers no reset when the drum is already linear', () => {
    render(DrumVelocityCurve, { props: props(mockStore()) });
    expect(screen.getByRole('button', { name: 'Reset to linear' }).hasAttribute('disabled')).toBe(true);
  });

  it('survives a project-less (offline) store rather than blanking the pane', () => {
    render(DrumVelocityCurve, { props: props(mockStore({ project: null })) });
    expect(screen.getByText('linear')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset to linear' }).hasAttribute('disabled')).toBe(true);
  });

  it('plots the store’s live hits for THIS drum', () => {
    const velocityHitsFor = vi.fn((drumId: string) => (drumId === 'kick' ? [{ x: 0.5, at: 1 }] : []));
    render(DrumVelocityCurve, { props: props(mockStore({ velocityHitsFor })) });
    expect(velocityHitsFor).toHaveBeenCalledWith('kick');
  });
});
