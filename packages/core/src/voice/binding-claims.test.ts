import { describe, expect, it } from 'vitest';
import {
  addressesForSource,
  bindingConflicts,
  canBindAddress,
  claimsForAddress,
  inputMapBindingRejections,
  isSameClaim,
  sourceBindingRejections,
  sourceClaimsAddress,
  type BindingClaim,
  type BindingScope,
} from './binding-claims';

// ---- fixtures ---------------------------------------------------------------

type CueSource = { midiNote?: number; midiCc?: number; oscAddress?: string };

/** A Cue Effect's claim-relevant shape. */
const cue = (id: string, source: CueSource): NonNullable<BindingScope['effects']>[number] => ({ id, trigger: { kind: 'cue', source } });

/** An empty scope with only the fields these tests read — the rest defaults. */
function scope(over: Partial<BindingScope['inputMap']> = {}, effects: NonNullable<BindingScope['effects']> = []): BindingScope {
  return {
    inputMap: {
      midiNotes: [],
      midiChannel: null,
      oscMap: [],
      zones: [],
      globalControls: {},
      ...over,
    } as BindingScope['inputMap'],
    effects,
  };
}

const GLOBAL: BindingClaim = { group: 'global-control', kind: 'global', action: 'nextSong' };
const OTHER_GLOBAL: BindingClaim = { group: 'global-control', kind: 'global', action: 'prevSong' };
const CUE: BindingClaim = { group: 'pad-trigger', kind: 'cue', effectId: 'c1' };
const OTHER_CUE: BindingClaim = { group: 'pad-trigger', kind: 'cue', effectId: 'c2' };
const ZONE: BindingClaim = { group: 'pad-trigger', kind: 'zone', drumId: 'snare', slot: 1 };

// ---- claim discovery --------------------------------------------------------

describe('claimsForAddress', () => {
  it('finds a zone-map note', () => {
    const s = scope({ midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] });
    expect(claimsForAddress(s, { kind: 'note', note: 60 })).toEqual([ZONE]);
  });

  it('finds a Cue Effect source', () => {
    const s = scope({}, [cue('c1', { midiNote: 60 })]);
    expect(claimsForAddress(s, { kind: 'note', note: 60 })).toEqual([CUE]);
  });

  it('finds a global control binding', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } });
    expect(claimsForAddress(s, { kind: 'note', note: 60 })).toEqual([GLOBAL]);
  });

  it('keeps the three address namespaces separate — note 60, CC 60 and an address never collide', () => {
    const s = scope({
      midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }],
      globalControls: { nextSong: { midiCc: 60, oscAddress: '/x' } },
    });
    expect(claimsForAddress(s, { kind: 'note', note: 60 })).toEqual([ZONE]);
    expect(claimsForAddress(s, { kind: 'cc', controller: 60 })).toEqual([GLOBAL]);
    expect(claimsForAddress(s, { kind: 'osc', address: '/x' })).toEqual([GLOBAL]);
  });

  it('a Cue claims each address it carries — note, CC and OSC — and nothing else', () => {
    const s = scope({}, [cue('c1', { midiNote: 60, midiCc: 7, oscAddress: '/go' })]);
    expect(claimsForAddress(s, { kind: 'note', note: 60 })).toEqual([CUE]);
    expect(claimsForAddress(s, { kind: 'cc', controller: 7 })).toEqual([CUE]);
    expect(claimsForAddress(s, { kind: 'osc', address: ' /go ' })).toEqual([CUE]);
    expect(claimsForAddress(s, { kind: 'note', note: 7 })).toEqual([]);
  });

  it('compares OSC addresses trimmed, so whitespace cannot smuggle a binding past a guard', () => {
    const s = scope({ globalControls: { nextSong: { oscAddress: '/go' } } });
    expect(claimsForAddress(s, { kind: 'osc', address: '  /go  ' })).toEqual([GLOBAL]);
  });

  it('reports reserved CC 0 as a claim', () => {
    expect(claimsForAddress(scope(), { kind: 'cc', controller: 0 })).toEqual([
      { group: 'reserved', kind: 'reservedCc', controller: 0 },
    ]);
  });

  it('returns nothing for a free address', () => {
    expect(claimsForAddress(scope(), { kind: 'note', note: 60 })).toEqual([]);
  });
});

// ---- the sharing rule -------------------------------------------------------

describe('bindingConflicts — within a group', () => {
  it('lets pads and Cues share a note with each other', () => {
    const s = scope({ midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] }, [cue('c1', { midiNote: 60 })]);
    // The Cue is joining a note a pad already has — same group, allowed.
    expect(canBindAddress(s, { kind: 'note', note: 60 }, CUE)).toBe(true);
    // ...and the reverse.
    expect(canBindAddress(s, { kind: 'note', note: 60 }, ZONE)).toBe(true);
  });

  it('lets two Cues share a note', () => {
    const s = scope({}, [cue('c1', { midiNote: 60 })]);
    expect(canBindAddress(s, { kind: 'note', note: 60 }, OTHER_CUE)).toBe(true);
  });

  it('refuses a second global control on one note — globals are unique', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } });
    expect(bindingConflicts(s, { kind: 'note', note: 60 }, OTHER_GLOBAL)).toEqual([GLOBAL]);
  });
});

describe('bindingConflicts — across groups, pads and globals block each other', () => {
  const padScope = scope({ midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] });
  const cueScope = scope({}, [cue('c1', { midiNote: 60 })]);
  const globalScope = scope({ globalControls: { nextSong: { midiNote: 60 } } });
  const note = { kind: 'note', note: 60 } as const;

  it('a pad or a Cue blocks a global', () => {
    expect(bindingConflicts(padScope, note, GLOBAL)).toEqual([ZONE]);
    expect(bindingConflicts(cueScope, note, GLOBAL)).toEqual([CUE]);
  });

  it('a global blocks a pad and a Cue', () => {
    expect(bindingConflicts(globalScope, note, ZONE)).toEqual([GLOBAL]);
    expect(bindingConflicts(globalScope, note, CUE)).toEqual([GLOBAL]);
  });

  it('reserved CC 0 blocks every group, including a global', () => {
    const cc0 = { kind: 'cc', controller: 0 } as const;
    for (const self of [CUE, ZONE, GLOBAL]) {
      expect(bindingConflicts(scope(), cc0, self)).toEqual([{ group: 'reserved', kind: 'reservedCc', controller: 0 }]);
    }
  });
});

describe('bindingConflicts — self', () => {
  it('re-saving a binding to its own current value is not a conflict', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } });
    expect(canBindAddress(s, { kind: 'note', note: 60 }, GLOBAL)).toBe(true);
  });

  it('a Cue re-hearing its own note during Learn is not a conflict', () => {
    const s = scope({}, [cue('c1', { midiNote: 60 })]);
    expect(canBindAddress(s, { kind: 'note', note: 60 }, CUE)).toBe(true);
  });

  it('but a DIFFERENT owner in a blocking group still conflicts', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } }, [cue('c1', { midiNote: 60 })]);
    // Editing the Cue: its own claim is excluded, the global still blocks.
    expect(bindingConflicts(s, { kind: 'note', note: 60 }, CUE)).toEqual([GLOBAL]);
  });
});

// ---- whole-map writes (setInputMap) ----------------------------------------

describe('inputMapBindingRejections', () => {
  const cues = { effects: [cue('c1', { midiNote: 60 })] };

  it('refuses a global note that a Cue already owns', () => {
    const current = scope().inputMap;
    const next = { ...current, globalControls: { nextSong: { midiNote: 60 } } };
    expect(inputMapBindingRejections(current, next, cues)).toEqual([
      { address: { kind: 'note', note: 60 }, self: GLOBAL, conflicts: [CUE] },
    ]);
  });

  it('allows a zone note that only a Cue owns — same group', () => {
    const current = scope().inputMap;
    const next = { ...current, midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] };
    expect(inputMapBindingRejections(current, next, cues)).toEqual([]);
  });

  it('ignores bindings it did not change — an unrelated edit is never blocked', () => {
    // A pre-existing collision (note 60 on both a zone and a global) must not stop the
    // user changing the MIDI channel, or they would be wedged out of their own patch.
    const current = {
      ...scope().inputMap,
      midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }],
      globalControls: { nextSong: { midiNote: 60 } },
    };
    const next = { ...current, midiChannel: 10 };
    expect(inputMapBindingRejections(current, next)).toEqual([]);
  });

  it('re-committing an unchanged global field does not refuse itself', () => {
    const current = { ...scope().inputMap, globalControls: { nextSong: { midiNote: 70 } } };
    const next = { ...current, globalControls: { nextSong: { midiNote: 70 } } };
    expect(inputMapBindingRejections(current, next)).toEqual([]);
  });

  it('catches two colliding bindings introduced by the SAME write', () => {
    const current = scope().inputMap;
    const next = {
      ...current,
      midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }],
      globalControls: { nextSong: { midiNote: 60 } },
    };
    // Both directions are reported — the zone sees the global, the global sees the zone.
    const out = inputMapBindingRejections(current, next);
    expect(out.map((r) => r.self)).toEqual([ZONE, GLOBAL]);
    expect(out[0]!.conflicts).toEqual([GLOBAL]);
    expect(out[1]!.conflicts).toEqual([ZONE]);
  });

  it('refuses a global CC of 0 — the section-recall reservation', () => {
    const current = scope().inputMap;
    const next = { ...current, globalControls: { masterBrightness: { midiCc: 0 } } };
    const out = inputMapBindingRejections(current, next);
    expect(out).toHaveLength(1);
    expect(out[0]!.conflicts).toEqual([{ group: 'reserved', kind: 'reservedCc', controller: 0 }]);
  });

  it('clearing a binding is never refused', () => {
    const current = { ...scope().inputMap, globalControls: { nextSong: { midiNote: 60 } } };
    const next = { ...current, globalControls: {} };
    expect(inputMapBindingRejections(current, next, cues)).toEqual([]);
  });
});

// ---- Cue source writes -----------------------------------------------------

describe('sourceBindingRejections', () => {
  it('refuses a Cue note a global owns', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } });
    expect(sourceBindingRejections(s, { kind: 'midi', note: 60 }, CUE)).toEqual([
      { address: { kind: 'note', note: 60 }, self: CUE, conflicts: [GLOBAL] },
    ]);
  });

  it('allows a Cue note another Cue owns', () => {
    const s = scope({}, [cue('c1', { midiNote: 60 })]);
    expect(sourceBindingRejections(s, { kind: 'midi', note: 60 }, OTHER_CUE)).toEqual([]);
  });

  it('allows a DRUM source even when the zone note is globally bound', () => {
    // The snare is note 60; note 60 is a global control. A drum source names the pad, not
    // the note, so the drum namespace is untouched by this rule.
    const s = scope({
      midiNotes: [{ note: 60, drumId: 'snare', slot: 0 }],
      globalControls: { nextSong: { midiNote: 60 } },
    });
    expect(sourceBindingRejections(s, { kind: 'drum', drumId: 'snare', zone: '0' }, CUE)).toEqual([]);
  });

  it('clearing a source is never refused', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } });
    expect(sourceBindingRejections(s, null, CUE)).toEqual([]);
  });

  it('checks a midi source that carries both a note and a CC', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 }, masterBrightness: { midiCc: 7 } } });
    const out = sourceBindingRejections(s, { kind: 'midi', note: 60, cc: 7 }, CUE);
    expect(out.map((r) => r.address)).toEqual([
      { kind: 'note', note: 60 },
      { kind: 'cc', controller: 7 },
    ]);
  });
});

// ---- helpers ----------------------------------------------------------------

describe('sourceClaimsAddress', () => {
  it('matches midi notes and CCs independently', () => {
    expect(sourceClaimsAddress({ kind: 'midi', note: 60 }, { kind: 'note', note: 60 })).toBe(true);
    expect(sourceClaimsAddress({ kind: 'midi', note: 60 }, { kind: 'cc', controller: 60 })).toBe(false);
    expect(sourceClaimsAddress({ kind: 'midi', cc: 7 }, { kind: 'cc', controller: 7 })).toBe(true);
  });

  it('never matches a drum source', () => {
    const drum = { kind: 'drum', drumId: 'snare', zone: '0' } as const;
    expect(sourceClaimsAddress(drum, { kind: 'note', note: 60 })).toBe(false);
    expect(sourceClaimsAddress(drum, { kind: 'osc', address: '/a' })).toBe(false);
  });
});

describe('addressesForSource', () => {
  it('a drum source occupies no input address', () => {
    expect(addressesForSource({ kind: 'drum', drumId: 'snare', zone: '0' })).toEqual([]);
  });

  it('a midi source may occupy both a note and a CC', () => {
    expect(addressesForSource({ kind: 'midi', note: 60, cc: 7 })).toEqual([
      { kind: 'note', note: 60 },
      { kind: 'cc', controller: 7 },
    ]);
  });

  it('an empty OSC address occupies nothing', () => {
    expect(addressesForSource({ kind: 'osc', address: '   ' })).toEqual([]);
    expect(addressesForSource({ kind: 'osc', address: ' /a ' })).toEqual([{ kind: 'osc', address: '/a' }]);
  });
});

describe('isSameClaim', () => {
  it('separates two Cues on different Effects', () => {
    expect(isSameClaim(CUE, OTHER_CUE)).toBe(false);
    expect(isSameClaim(CUE, { ...CUE })).toBe(true);
  });

  it('separates claims of different kinds that share a group', () => {
    expect(isSameClaim(ZONE, CUE)).toBe(false);
  });
});
