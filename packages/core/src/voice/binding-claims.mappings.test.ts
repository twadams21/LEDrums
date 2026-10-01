import { describe, expect, it } from 'vitest';
import { inputMappingTargetId, type InputMapping, type InputMappingTarget } from '../effect-chain/input-mappings';
import { parseEffect } from '../effect-chain/types';
import {
  addressForMappingSource,
  claimsForAddress,
  inputMapBindingRejections,
  inputMappingConflicts,
  isSameClaim,
  type BindingClaim,
  type BindingScope,
} from './binding-claims';

/* MIDI-map InputMappings (effect chains S07) in the binding-claims guard: a mapping is
   consumed at global-control precedence, so it must be unique on its address — against
   zones, Cue Effects, globals, the reserved CC and other mappings. */

// ---- fixtures ---------------------------------------------------------------

type ScopeOverrides = Partial<Omit<BindingScope, 'inputMap'>> & { inputMap?: Partial<BindingScope['inputMap']> };

/** An empty scope with only the fields these tests read — the rest defaults. */
function scope(over: ScopeOverrides = {}): BindingScope {
  const { inputMap, ...rest } = over;
  return {
    ...rest,
    inputMap: {
      midiNotes: [],
      midiChannel: null,
      oscMap: [],
      zones: [],
      globalControls: {},
      ...inputMap,
    } as BindingScope['inputMap'],
  };
}

const CELL_TARGET: InputMappingTarget = { kind: 'fireCell', cell: { row: 'snare', column: { kind: 'zone', slot: 0 } } };
const OPACITY_TARGET: InputMappingTarget = { kind: 'opacity', effectId: 'e1' };
const CELL_ID = inputMappingTargetId(CELL_TARGET);
const OPACITY_ID = inputMappingTargetId(OPACITY_TARGET);

const mapping = (id: string, source: InputMapping['source'], target: InputMappingTarget): InputMapping => ({ id, source, target });

const cueEffect = (id: string, source: { midiNote?: number; midiCc?: number; oscAddress?: string }) =>
  parseEffect({
    id,
    cell: { row: 'kit', column: { kind: 'cue' } },
    trigger: { kind: 'cue', source },
    generator: { kind: 'solid', style: 'solid', params: {} },
  });

const mappingClaim = (targetId: string): BindingClaim => ({ group: 'mapping', kind: 'mapping', targetId });

// ---- sources → addresses ----------------------------------------------------

describe('addressForMappingSource', () => {
  it('maps each of the four source kinds to its own namespace', () => {
    expect(addressForMappingSource({ midiNote: 60 })).toEqual({ kind: 'note', note: 60 });
    expect(addressForMappingSource({ midiCc: 21 })).toEqual({ kind: 'cc', controller: 21 });
    expect(addressForMappingSource({ oscAddress: ' /x ' })).toEqual({ kind: 'osc', address: '/x' });
    expect(addressForMappingSource({ key: 'KeyQ' })).toEqual({ kind: 'key', code: 'KeyQ' });
  });
});

// ---- claim discovery --------------------------------------------------------

describe('claimsForAddress — mappings and cues', () => {
  it('finds a mapping on its address, identified by its target id', () => {
    const s = scope({ mappings: [mapping('m1', { midiNote: 60 }, CELL_TARGET)] });
    expect(claimsForAddress(s, { kind: 'note', note: 60 })).toEqual([mappingClaim(CELL_ID)]);
    expect(claimsForAddress(s, { kind: 'cc', controller: 60 })).toEqual([]);
  });

  it('finds a Cue Effect on each address its source carries', () => {
    const s = scope({ effects: [cueEffect('c1', { midiNote: 40, midiCc: 7, oscAddress: '/cue' })] });
    const cue: BindingClaim = { group: 'pad-trigger', kind: 'cue', effectId: 'c1' };
    expect(claimsForAddress(s, { kind: 'note', note: 40 })).toEqual([cue]);
    expect(claimsForAddress(s, { kind: 'cc', controller: 7 })).toEqual([cue]);
    expect(claimsForAddress(s, { kind: 'osc', address: ' /cue ' })).toEqual([cue]);
  });

  it('ignores non-cue Effects — a zone Effect claims nothing here, its zone does', () => {
    const zoneEffect = parseEffect({
      id: 'z1',
      cell: { row: 'snare', column: { kind: 'zone', slot: 0 } },
      generator: { kind: 'solid', style: 'solid', params: {} },
    });
    expect(claimsForAddress(scope({ effects: [zoneEffect] }), { kind: 'note', note: 60 })).toEqual([]);
  });

  it('orders mappings after every other owner, so the refusal names the authoritative blocker', () => {
    const s = scope({
      inputMap: { midiNotes: [{ note: 60, drumId: 'snare', slot: 0 }], globalControls: { nextSong: { midiNote: 60 } } },
      effects: [cueEffect('c1', { midiNote: 60 })],
      mappings: [mapping('m1', { midiNote: 60 }, CELL_TARGET)],
    });
    expect(claimsForAddress(s, { kind: 'note', note: 60 }).map((c) => c.kind)).toEqual(['zone', 'cue', 'global', 'mapping']);
  });

  it('a key address is claimed only by key mappings', () => {
    const s = scope({
      inputMap: { globalControls: { nextSong: { midiNote: 60 } } },
      mappings: [mapping('m1', { key: 'KeyQ' }, CELL_TARGET)],
    });
    expect(claimsForAddress(s, { kind: 'key', code: 'KeyQ' })).toEqual([mappingClaim(CELL_ID)]);
    expect(claimsForAddress(s, { kind: 'key', code: 'KeyW' })).toEqual([]);
  });
});

// ---- inputMappingConflicts --------------------------------------------------

describe('inputMappingConflicts', () => {
  it('allows a free address', () => {
    expect(inputMappingConflicts(scope(), { midiNote: 60 }, CELL_ID)).toEqual([]);
  });

  it('refuses a note a zone already has — the mapping would starve the pad', () => {
    const s = scope({ inputMap: { midiNotes: [{ note: 60, drumId: 'snare', slot: 1 }] } });
    expect(inputMappingConflicts(s, { midiNote: 60 }, CELL_ID)).toEqual([
      {
        address: { kind: 'note', note: 60 },
        self: mappingClaim(CELL_ID),
        conflicts: [{ group: 'pad-trigger', kind: 'zone', drumId: 'snare', slot: 1 }],
      },
    ]);
  });

  it('refuses a zone OSC address', () => {
    const s = scope({ inputMap: { oscMap: [{ address: '/snare', drumId: 'snare', slot: 0 }] } });
    expect(inputMappingConflicts(s, { oscAddress: '/snare' }, CELL_ID)[0]?.conflicts).toEqual([
      { group: 'pad-trigger', kind: 'zone', drumId: 'snare', slot: 0 },
    ]);
  });

  it('refuses a global control on the same note, CC or OSC address', () => {
    const s = scope({ inputMap: { globalControls: { nextSong: { midiNote: 60, oscAddress: '/next' }, masterBrightness: { midiCc: 7 } } } });
    expect(inputMappingConflicts(s, { midiNote: 60 }, CELL_ID)[0]?.conflicts).toEqual([
      { group: 'global-control', kind: 'global', action: 'nextSong' },
    ]);
    expect(inputMappingConflicts(s, { oscAddress: '/next' }, CELL_ID)).toHaveLength(1);
    expect(inputMappingConflicts(s, { midiCc: 7 }, OPACITY_ID)[0]?.conflicts).toEqual([
      { group: 'global-control', kind: 'global', action: 'masterBrightness' },
    ]);
  });

  it('refuses the reserved section-recall CC 0', () => {
    expect(inputMappingConflicts(scope(), { midiCc: 0 }, OPACITY_ID)[0]?.conflicts).toEqual([
      { group: 'reserved', kind: 'reservedCc', controller: 0 },
    ]);
  });

  it('refuses a Cue Effect on the same address — the mapping would consume the cue input', () => {
    const s = scope({ effects: [cueEffect('c1', { midiCc: 21 })] });
    expect(inputMappingConflicts(s, { midiCc: 21 }, OPACITY_ID)[0]?.conflicts).toEqual([
      { group: 'pad-trigger', kind: 'cue', effectId: 'c1' },
    ]);
  });

  it('refuses another mapping on the same source — mappings are unique', () => {
    const s = scope({ mappings: [mapping('m1', { midiCc: 21 }, OPACITY_TARGET)] });
    expect(inputMappingConflicts(s, { midiCc: 21 }, CELL_ID)[0]?.conflicts).toEqual([mappingClaim(OPACITY_ID)]);
  });

  it('refuses a key another key mapping already has, and ignores the other namespaces', () => {
    const s = scope({
      inputMap: { midiNotes: [{ note: 60, drumId: 'snare', slot: 0 }] },
      mappings: [mapping('m1', { key: 'KeyQ' }, OPACITY_TARGET)],
    });
    expect(inputMappingConflicts(s, { key: 'KeyQ' }, CELL_ID)[0]?.address).toEqual({ kind: 'key', code: 'KeyQ' });
    expect(inputMappingConflicts(s, { key: 'KeyW' }, CELL_ID)).toEqual([]);
  });

  it('never refuses a target re-learning its own source, or re-binding to a new one', () => {
    const s = scope({ mappings: [mapping('m1', { midiNote: 60 }, CELL_TARGET)] });
    expect(inputMappingConflicts(s, { midiNote: 60 }, CELL_ID)).toEqual([]);
    expect(inputMappingConflicts(s, { midiNote: 61 }, CELL_ID)).toEqual([]);
  });

  it('keeps note and CC namespaces apart — CC 60 is free while note 60 is mapped', () => {
    const s = scope({ mappings: [mapping('m1', { midiNote: 60 }, CELL_TARGET)] });
    expect(inputMappingConflicts(s, { midiCc: 60 }, OPACITY_ID)).toEqual([]);
  });
});

// ---- the reverse direction: existing writers now see mappings ----------------

describe('mappings block the other editors', () => {
  const mappings = [mapping('m1', { midiNote: 60 }, CELL_TARGET)];
  const empty = scope().inputMap;

  it('a zone write onto a mapped note is refused when the show claims are passed', () => {
    const next = { ...empty, midiNotes: [{ note: 60, drumId: 'snare', slot: 0 }] };
    const rejections = inputMapBindingRejections(empty, next, { mappings });
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.conflicts).toEqual([mappingClaim(CELL_ID)]);
  });

  it('a global-control write onto a mapped note is refused', () => {
    const next = { ...empty, globalControls: { nextSong: { midiNote: 60 } } };
    expect(inputMapBindingRejections(empty, next, { mappings })[0]?.conflicts).toEqual([mappingClaim(CELL_ID)]);
  });

  it('without show claims nothing is claimed there', () => {
    const next = { ...empty, midiNotes: [{ note: 60, drumId: 'snare', slot: 0 }] };
    expect(inputMapBindingRejections(empty, next)).toEqual([]);
  });

  it('a zone still shares with a Cue — same group, by design', () => {
    const next = { ...empty, midiNotes: [{ note: 40, drumId: 'snare', slot: 0 }] };
    expect(inputMapBindingRejections(empty, next, { effects: [cueEffect('c1', { midiNote: 40 })] })).toEqual([]);
  });

  it('a global control on a Cue note is refused', () => {
    const next = { ...empty, globalControls: { nextSong: { midiNote: 40 } } };
    expect(inputMapBindingRejections(empty, next, { effects: [cueEffect('c1', { midiNote: 40 })] })[0]?.conflicts).toEqual([
      { group: 'pad-trigger', kind: 'cue', effectId: 'c1' },
    ]);
  });
});

describe('isSameClaim — new kinds', () => {
  it('identifies a mapping by target and a cue by Effect', () => {
    expect(isSameClaim(mappingClaim(CELL_ID), mappingClaim(CELL_ID))).toBe(true);
    expect(isSameClaim(mappingClaim(CELL_ID), mappingClaim(OPACITY_ID))).toBe(false);
    expect(
      isSameClaim({ group: 'pad-trigger', kind: 'cue', effectId: 'a' }, { group: 'pad-trigger', kind: 'cue', effectId: 'b' }),
    ).toBe(false);
  });
});
