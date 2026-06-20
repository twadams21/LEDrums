import { describe, expect, it } from 'vitest';
import { Engine, defaultProject } from '@ledrums/core';
import { applyClientMessage, midiToEvent, oscToEvent } from './input-router';

describe('input-router', () => {
  it('normalizes MIDI velocity and distinguishes note on/off', () => {
    expect(midiToEvent(38, 127, true, 5)).toEqual({ kind: 'noteOn', note: 38, velocity: 1, timeMs: 5 });
    expect(midiToEvent(38, 0, true, 5)).toEqual({ kind: 'noteOff', note: 38, timeMs: 5 });
    expect(midiToEvent(38, 100, false, 5)).toEqual({ kind: 'noteOff', note: 38, timeMs: 5 });
  });

  it('extracts the first numeric arg from an OSC event', () => {
    expect(oscToEvent({ address: '/p', args: ['x', 0.7] }, 0)).toEqual({ kind: 'osc', address: '/p', value: 0.7, timeMs: 0 });
  });

  it('routes a mapped MIDI note through the engine to activate its trigger clip', () => {
    const e = new Engine(defaultProject());
    e.setActiveClip('trigger', 'whole-drum');
    const r = applyClientMessage(e, { t: 'midi', note: 38, velocity: 100, on: true }, 0);
    e.tick(16);
    expect(r.structural).toBe(false);
    expect(r.monitor?.kind).toBe('midi');
    expect(e.getProject().composition.layers.find((l) => l.id === 'trigger')!.activeClipId).toBe('chase');
  });

  it('applies setParam without a structural change', () => {
    const e = new Engine(defaultProject());
    const r = applyClientMessage(e, { t: 'setParam', layerId: 'base', clipId: 'base-swirl', key: 'hue', value: 99 }, 0);
    expect(r.structural).toBe(false);
    expect(e.getProject().composition.layers[0]!.clips[0]!.params.hue).toBe(99);
  });

  it('ignores an unmapped MIDI note without throwing', () => {
    const e = new Engine(defaultProject());
    expect(() => applyClientMessage(e, { t: 'midi', note: 7, velocity: 100, on: true }, 0)).not.toThrow();
    e.tick(16);
  });

  it('marks structural changes for layer/transport edits', () => {
    const e = new Engine(defaultProject());
    expect(applyClientMessage(e, { t: 'setLayer', layerId: 'base', opacity: 0.5 }, 0).structural).toBe(true);
    expect(applyClientMessage(e, { t: 'setTransport', bpm: 140 }, 0).structural).toBe(true);
  });
});
