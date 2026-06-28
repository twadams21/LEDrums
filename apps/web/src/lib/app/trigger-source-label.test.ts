import { describe, expect, it } from 'vitest';
import { describeTriggerSource, zoneLabel } from './trigger-source-label';
import type { TriggerSource } from '../trigger-lab/sim';

/** A small drum roster (id → label) — the shape of store.drums. */
const DRUMS = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
];

describe('zoneLabel', () => {
  it('maps the numeric zone index to its hoop label', () => {
    expect(zoneLabel('0')).toBe('center');
    expect(zoneLabel('1')).toBe('edge');
    expect(zoneLabel('2')).toBe('rim');
    expect(zoneLabel('3')).toBe('shell');
  });

  it('falls back to the raw value for an out-of-range or non-numeric zone', () => {
    expect(zoneLabel('9')).toBe('9');
    expect(zoneLabel('foo')).toBe('foo');
    expect(zoneLabel('')).toBe('');
  });
});

describe('describeTriggerSource', () => {
  it('describes a drum source as "Drum" + drum · zone, resolving the label from drums', () => {
    const src: TriggerSource = { kind: 'drum', drumId: 'kick', zone: '0' };
    expect(describeTriggerSource(src, DRUMS)).toEqual({ label: 'Drum', sub: 'Kick · center' });
  });

  it('falls back to the raw drum id when it is not in the roster', () => {
    const src: TriggerSource = { kind: 'drum', drumId: 'ghost', zone: '2' };
    expect(describeTriggerSource(src, DRUMS)).toEqual({ label: 'Drum', sub: 'ghost · rim' });
  });

  it('handles zone index 0 (a falsy-looking but valid zone)', () => {
    expect(describeTriggerSource({ kind: 'drum', drumId: 'snare', zone: '0' }, DRUMS).sub).toBe('Snare · center');
  });

  it('describes a MIDI note source', () => {
    expect(describeTriggerSource({ kind: 'midi', note: 38 }, DRUMS)).toEqual({ label: 'MIDI', sub: 'MIDI note 38' });
  });

  it('describes a MIDI CC source (CC takes precedence over note)', () => {
    expect(describeTriggerSource({ kind: 'midi', cc: 74 }, DRUMS)).toEqual({ label: 'MIDI', sub: 'MIDI CC 74' });
    expect(describeTriggerSource({ kind: 'midi', note: 1, cc: 74 }, DRUMS).sub).toBe('MIDI CC 74');
  });

  it('handles a MIDI source with neither note nor CC set', () => {
    expect(describeTriggerSource({ kind: 'midi' }, DRUMS)).toEqual({ label: 'MIDI', sub: 'MIDI — set a note' });
  });

  it('describes an OSC source', () => {
    expect(describeTriggerSource({ kind: 'osc', address: '/kick' }, DRUMS)).toEqual({ label: 'OSC', sub: 'OSC /kick' });
  });

  it('handles an OSC source with an empty / whitespace address', () => {
    expect(describeTriggerSource({ kind: 'osc', address: '  ' }, DRUMS)).toEqual({ label: 'OSC', sub: 'OSC — set an address' });
  });

  it('shows an unbound placeholder when the source is unset (authored graph)', () => {
    expect(describeTriggerSource(undefined, DRUMS)).toEqual({ label: 'Trigger', sub: 'unbound' });
  });
});
