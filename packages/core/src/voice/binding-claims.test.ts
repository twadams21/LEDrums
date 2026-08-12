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
import type { GraphNode, TriggerGraph } from './types';

// ---- fixtures ---------------------------------------------------------------

const node = (over: Partial<GraphNode> & Pick<GraphNode, 'id' | 'kind'>): GraphNode =>
  ({ x: 0, y: 0, params: {}, ...over }) as GraphNode;

const graph = (...nodes: GraphNode[]): TriggerGraph => ({ nodes, edges: [] }) as TriggerGraph;

/** An empty scope with only the fields these tests read — the rest defaults. */
function scope(over: Partial<BindingScope['inputMap']> = {}, graphs: Record<string, TriggerGraph> = {}): BindingScope {
  return {
    inputMap: {
      midiNotes: [],
      midiChannel: null,
      oscMap: [],
      zones: [],
      globalControls: {},
      ...over,
    } as BindingScope['inputMap'],
    graphs,
  };
}

const GLOBAL: BindingClaim = { group: 'global-control', kind: 'global', action: 'nextSong' };
const OTHER_GLOBAL: BindingClaim = { group: 'global-control', kind: 'global', action: 'prevSong' };
const RESET: BindingClaim = { group: 'sequence-reset', kind: 'reset', graphKey: 'g', nodeId: 'n1' };
const OTHER_RESET: BindingClaim = { group: 'sequence-reset', kind: 'reset', graphKey: 'g', nodeId: 'n2' };
const TRIGGER: BindingClaim = { group: 'pad-trigger', kind: 'triggerNode', graphKey: 'g', nodeId: 't1' };
const ZONE: BindingClaim = { group: 'pad-trigger', kind: 'zone', drumId: 'snare', slot: 1 };

// ---- claim discovery --------------------------------------------------------

describe('claimsForAddress', () => {
  it('finds a zone-map note', () => {
    const s = scope({ midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] });
    expect(claimsForAddress(s, { kind: 'note', note: 60 })).toEqual([ZONE]);
  });

  it('finds trigger sources and sequence resets in one pass, as different groups', () => {
    const s = scope({}, {
      g: graph(
        node({ id: 't1', kind: 'trigger', source: { kind: 'midi', note: 60 } }),
        node({ id: 'n1', kind: 'sequence', resetSource: { kind: 'midi', note: 60 } }),
      ),
    });
    expect(claimsForAddress(s, { kind: 'note', note: 60 })).toEqual([TRIGGER, RESET]);
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

  it('a drum source claims NOTHING — issue #159 pad-does-both must survive', () => {
    const s = scope({ midiNotes: [{ note: 60, drumId: 'snare', slot: 0 }] }, {
      g: graph(
        node({ id: 't1', kind: 'trigger', source: { kind: 'drum', drumId: 'snare', zone: '0' } }),
        node({ id: 'n1', kind: 'sequence', resetSource: { kind: 'drum', drumId: 'snare', zone: '0' } }),
      ),
    });
    // Only the zone map itself claims note 60; both drum-bound nodes are invisible here,
    // so one snare hit still fires the graph AND resets the sequencer.
    expect(claimsForAddress(s, { kind: 'note', note: 60 })).toEqual([
      { group: 'pad-trigger', kind: 'zone', drumId: 'snare', slot: 0 },
    ]);
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
  it('lets pads and trigger nodes share a note with each other', () => {
    const s = scope({ midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] }, {
      g: graph(node({ id: 't1', kind: 'trigger', source: { kind: 'midi', note: 60 } })),
    });
    // The trigger node is joining a note a pad already has — same group, allowed.
    expect(canBindAddress(s, { kind: 'note', note: 60 }, TRIGGER)).toBe(true);
    // ...and the reverse.
    expect(canBindAddress(s, { kind: 'note', note: 60 }, ZONE)).toBe(true);
  });

  it('lets two sequence resets share a note', () => {
    const s = scope({}, { g: graph(node({ id: 'n1', kind: 'sequence', resetSource: { kind: 'midi', note: 60 } })) });
    expect(canBindAddress(s, { kind: 'note', note: 60 }, OTHER_RESET)).toBe(true);
  });

  it('refuses a second global control on one note — globals are unique', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } });
    expect(bindingConflicts(s, { kind: 'note', note: 60 }, OTHER_GLOBAL)).toEqual([GLOBAL]);
  });
});

describe('bindingConflicts — across groups, all three block each other', () => {
  const padScope = scope({ midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] });
  const resetScope = scope({}, { g: graph(node({ id: 'n1', kind: 'sequence', resetSource: { kind: 'midi', note: 60 } })) });
  const globalScope = scope({ globalControls: { nextSong: { midiNote: 60 } } });
  const note = { kind: 'note', note: 60 } as const;

  it('a pad blocks a reset and a global', () => {
    expect(bindingConflicts(padScope, note, RESET)).toEqual([ZONE]);
    expect(bindingConflicts(padScope, note, GLOBAL)).toEqual([ZONE]);
  });

  it('a reset blocks a pad/trigger and a global', () => {
    expect(bindingConflicts(resetScope, note, TRIGGER)).toEqual([RESET]);
    expect(bindingConflicts(resetScope, note, GLOBAL)).toEqual([RESET]);
  });

  it('a global blocks a pad/trigger and a reset', () => {
    expect(bindingConflicts(globalScope, note, TRIGGER)).toEqual([GLOBAL]);
    expect(bindingConflicts(globalScope, note, RESET)).toEqual([GLOBAL]);
  });

  it('reserved CC 0 blocks every group, including a global', () => {
    const cc0 = { kind: 'cc', controller: 0 } as const;
    for (const self of [TRIGGER, RESET, GLOBAL]) {
      expect(bindingConflicts(scope(), cc0, self)).toEqual([{ group: 'reserved', kind: 'reservedCc', controller: 0 }]);
    }
  });
});

describe('bindingConflicts — self', () => {
  it('re-saving a binding to its own current value is not a conflict', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } });
    expect(canBindAddress(s, { kind: 'note', note: 60 }, GLOBAL)).toBe(true);
  });

  it('a reset re-hearing its own note during Learn is not a conflict', () => {
    const s = scope({}, { g: graph(node({ id: 'n1', kind: 'sequence', resetSource: { kind: 'midi', note: 60 } })) });
    expect(canBindAddress(s, { kind: 'note', note: 60 }, RESET)).toBe(true);
  });

  it('but a DIFFERENT owner in a blocking group still conflicts', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } }, {
      g: graph(node({ id: 'n1', kind: 'sequence', resetSource: { kind: 'midi', note: 60 } })),
    });
    // Editing the reset: its own claim is excluded, the global still blocks.
    expect(bindingConflicts(s, { kind: 'note', note: 60 }, RESET)).toEqual([GLOBAL]);
  });
});

// ---- whole-map writes (setInputMap) ----------------------------------------

describe('inputMapBindingRejections', () => {
  const graphs = { g: graph(node({ id: 'n1', kind: 'sequence', resetSource: { kind: 'midi', note: 60 } })) };

  it('refuses a zone note that a sequence reset already owns', () => {
    const current = scope().inputMap;
    const next = { ...current, midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] };
    expect(inputMapBindingRejections(current, next, graphs)).toEqual([
      { address: { kind: 'note', note: 60 }, self: ZONE, conflicts: [RESET] },
    ]);
  });

  it('refuses a global note that a sequence reset already owns', () => {
    const current = scope().inputMap;
    const next = { ...current, globalControls: { nextSong: { midiNote: 60 } } };
    expect(inputMapBindingRejections(current, next, graphs)).toEqual([
      { address: { kind: 'note', note: 60 }, self: GLOBAL, conflicts: [RESET] },
    ]);
  });

  it('allows a zone note that only a trigger node owns — same group', () => {
    const g = { g: graph(node({ id: 't1', kind: 'trigger', source: { kind: 'midi', note: 60 } })) };
    const current = scope().inputMap;
    const next = { ...current, midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] };
    expect(inputMapBindingRejections(current, next, g)).toEqual([]);
  });

  it('ignores bindings it did not change — an unrelated edit is never blocked', () => {
    // A pre-existing collision (note 60 on both a zone and a reset) must not stop the
    // user changing the MIDI channel, or they would be wedged out of their own patch.
    const current = { ...scope().inputMap, midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] };
    const next = { ...current, midiChannel: 10 };
    expect(inputMapBindingRejections(current, next, graphs)).toEqual([]);
  });

  it('re-committing an unchanged global field does not refuse itself', () => {
    const current = { ...scope().inputMap, globalControls: { nextSong: { midiNote: 70 } } };
    const next = { ...current, globalControls: { nextSong: { midiNote: 70 } } };
    expect(inputMapBindingRejections(current, next, {})).toEqual([]);
  });

  it('catches two colliding bindings introduced by the SAME write', () => {
    const current = scope().inputMap;
    const next = {
      ...current,
      midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }],
      globalControls: { nextSong: { midiNote: 60 } },
    };
    // Both directions are reported — the zone sees the global, the global sees the zone.
    const out = inputMapBindingRejections(current, next, {});
    expect(out.map((r) => r.self)).toEqual([ZONE, GLOBAL]);
    expect(out[0]!.conflicts).toEqual([GLOBAL]);
    expect(out[1]!.conflicts).toEqual([ZONE]);
  });

  it('refuses a global CC of 0 — the section-recall reservation', () => {
    const current = scope().inputMap;
    const next = { ...current, globalControls: { masterBrightness: { midiCc: 0 } } };
    const out = inputMapBindingRejections(current, next, {});
    expect(out).toHaveLength(1);
    expect(out[0]!.conflicts).toEqual([{ group: 'reserved', kind: 'reservedCc', controller: 0 }]);
  });

  it('clearing a binding is never refused', () => {
    const current = { ...scope().inputMap, globalControls: { nextSong: { midiNote: 60 } } };
    const next = { ...current, globalControls: {} };
    expect(inputMapBindingRejections(current, next, graphs)).toEqual([]);
  });
});

// ---- node source writes -----------------------------------------------------

describe('sourceBindingRejections', () => {
  it('refuses a reset note a global owns', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } });
    expect(sourceBindingRejections(s, { kind: 'midi', note: 60 }, RESET)).toEqual([
      { address: { kind: 'note', note: 60 }, self: RESET, conflicts: [GLOBAL] },
    ]);
  });

  it('allows a reset note another reset owns', () => {
    const s = scope({}, { g: graph(node({ id: 'n1', kind: 'sequence', resetSource: { kind: 'midi', note: 60 } })) });
    expect(sourceBindingRejections(s, { kind: 'midi', note: 60 }, OTHER_RESET)).toEqual([]);
  });

  it('allows a DRUM reset source even when the zone note is globally bound — issue #159', () => {
    // The snare is note 60; note 60 is a global control. Binding the reset to the DRUM
    // still works, because the drum namespace is untouched by this rule.
    const s = scope({
      midiNotes: [{ note: 60, drumId: 'snare', slot: 0 }],
      globalControls: { nextSong: { midiNote: 60 } },
    });
    expect(sourceBindingRejections(s, { kind: 'drum', drumId: 'snare', zone: '0' }, RESET)).toEqual([]);
  });

  it('clearing a source is never refused', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 } } });
    expect(sourceBindingRejections(s, null, RESET)).toEqual([]);
  });

  it('checks a midi source that carries both a note and a CC', () => {
    const s = scope({ globalControls: { nextSong: { midiNote: 60 }, masterBrightness: { midiCc: 7 } } });
    const out = sourceBindingRejections(s, { kind: 'midi', note: 60, cc: 7 }, RESET);
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
  it('separates two resets on different nodes', () => {
    expect(isSameClaim(RESET, OTHER_RESET)).toBe(false);
    expect(isSameClaim(RESET, { ...RESET })).toBe(true);
  });

  it('separates claims of different kinds that share a group', () => {
    expect(isSameClaim(ZONE, TRIGGER)).toBe(false);
  });
});
