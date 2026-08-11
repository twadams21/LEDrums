import { describe, expect, it } from 'vitest';
import type { InputMap } from '@ledrums/core';
import { globalControlZoneWarning } from './global-control-labels';

const DRUMS = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
];

const inputMap: InputMap = {
  midiChannel: null,
  globalControls: {},
  zones: [],
  midiNotes: [{ note: 36, drumId: 'kick', slot: 0 }],
  oscMap: [{ address: '/snare', drumId: 'snare', slot: 2 }],
};

describe('globalControlZoneWarning', () => {
  it('warns when the bound note is a mapped drum zone', () => {
    expect(globalControlZoneWarning(inputMap, { midiNote: 36 }, DRUMS)).toBe('overrides drum trigger: Kick · center');
  });

  it('warns when the bound address is a mapped drum zone', () => {
    expect(globalControlZoneWarning(inputMap, { oscAddress: '/snare' }, DRUMS)).toBe(
      // slot 2 reads 'rim' in the web ZONE_LABELS (core's SLOT_LABELS name it 'rim-tip').
      'overrides drum trigger: Snare · rim',
    );
  });

  it('says OVERRIDES, not "also" — the zone stops firing entirely', () => {
    // The distinction matters: a trigger-source graph and a zone both fire for one
    // message, but a global control consumes it. "also" here would be a lie that costs
    // someone an evening hunting a dead pad.
    const text = globalControlZoneWarning(inputMap, { midiNote: 36 }, DRUMS)!;
    expect(text).toContain('overrides');
    expect(text).not.toContain('also');
  });

  it('is null when nothing collides', () => {
    expect(globalControlZoneWarning(inputMap, { midiNote: 99, oscAddress: '/free' }, DRUMS)).toBeNull();
  });

  it('is null for an unbound control', () => {
    expect(globalControlZoneWarning(inputMap, undefined, DRUMS)).toBeNull();
    expect(globalControlZoneWarning(inputMap, {}, DRUMS)).toBeNull();
  });

  it('ignores a whitespace-only address', () => {
    expect(globalControlZoneWarning(inputMap, { oscAddress: '   ' }, DRUMS)).toBeNull();
  });

  it('reports the note collision first when both collide', () => {
    expect(globalControlZoneWarning(inputMap, { midiNote: 36, oscAddress: '/snare' }, DRUMS)).toContain('Kick');
  });

  it('falls back to the drum id when the roster has no label for it', () => {
    expect(globalControlZoneWarning(inputMap, { midiNote: 36 }, [])).toBe('overrides drum trigger: kick · center');
  });
});
