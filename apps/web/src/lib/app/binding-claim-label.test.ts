import { describe, expect, it } from 'vitest';
import { bindingRejectionMessage, describeBindingAddress, describeBindingClaim } from './binding-claim-label';
import type { DrumRef } from './trigger-source-label';

/* The copy a refused binding shows. These assert the message NAMES the blocker — the whole
   point of the guard is that the user can go and clear the thing in the way, which a
   generic "already in use" would not let them do. */

const DRUMS: readonly DrumRef[] = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
];

describe('describeBindingAddress', () => {
  it('renders each namespace in the same phrasing the source labels use', () => {
    expect(describeBindingAddress({ kind: 'note', note: 60 })).toBe('MIDI C4');
    expect(describeBindingAddress({ kind: 'cc', controller: 7 })).toBe('MIDI CC 7');
    expect(describeBindingAddress({ kind: 'osc', address: '  /go  ' })).toBe('OSC /go');
    expect(describeBindingAddress({ kind: 'key', code: 'KeyQ' })).toBe('Key Q');
    expect(describeBindingAddress({ kind: 'key', code: 'Digit1' })).toBe('Key 1');
  });
});

describe('describeBindingClaim', () => {
  it('names a drum zone by its drum and zone', () => {
    const text = describeBindingClaim({ group: 'pad-trigger', kind: 'zone', drumId: 'kick', slot: 0 }, DRUMS);
    expect(text).toContain('Kick');
    expect(text).toContain('center');
  });

  it('names a global control by its catalogue label, not its id', () => {
    const text = describeBindingClaim({ group: 'global-control', kind: 'global', action: 'nextSong' }, DRUMS);
    expect(text).toContain('Next song');
    expect(text).not.toContain('nextSong');
  });

  it('names a Cue Effect trigger', () => {
    expect(describeBindingClaim({ group: 'pad-trigger', kind: 'cue', effectId: 'e1' }, DRUMS)).toBe(
      'the trigger for a Cue Effect',
    );
  });

  it('names a MIDI-map mapping by what its target drives', () => {
    expect(
      describeBindingClaim({ group: 'mapping', kind: 'mapping', targetId: 'fireCell:snare:zone0' }, DRUMS),
    ).toBe('the MIDI-map mapping for a grid cell');
    expect(
      describeBindingClaim({ group: 'mapping', kind: 'mapping', targetId: 'modifierMix:e1:m1' }, DRUMS),
    ).toBe('the MIDI-map mapping for a Modifier’s mix');
  });

  it('explains the reserved CC rather than naming a phantom owner', () => {
    expect(describeBindingClaim({ group: 'reserved', kind: 'reservedCc', controller: 0 }, DRUMS)).toBe(
      'reserved for global section recall',
    );
  });
});

describe('bindingRejectionMessage', () => {
  it('says what was refused, who has it, and what to do', () => {
    const message = bindingRejectionMessage(
      {
        address: { kind: 'note', note: 60 },
        self: { group: 'global-control', kind: 'global', action: 'nextSong' },
        conflicts: [{ group: 'pad-trigger', kind: 'cue', effectId: 'e1' }],
      },
      DRUMS,
    );
    expect(message).toBe('MIDI C4 is already the trigger for a Cue Effect — clear that binding first, or pick another input.');
  });

  it('names only the first blocker when several hold the address', () => {
    const message = bindingRejectionMessage(
      {
        address: { kind: 'note', note: 60 },
        self: { group: 'global-control', kind: 'global', action: 'nextSong' },
        conflicts: [
          { group: 'pad-trigger', kind: 'zone', drumId: 'snare', slot: 0 },
          { group: 'pad-trigger', kind: 'cue', effectId: 'e1' },
        ],
      },
      DRUMS,
    );
    expect(message).toContain('Snare');
    expect(message).not.toContain('Cue Effect');
  });
});
