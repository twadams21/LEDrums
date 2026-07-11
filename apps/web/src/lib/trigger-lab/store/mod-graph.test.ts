import { describe, expect, it } from 'vitest';
import {
  addModInput,
  availableModParams,
  edgesWithoutParamWires,
  mappingsFor,
  modInputsOf,
  modSourcesFor,
  modTargetSpecs,
  removeModInput,
} from './mod-graph';
import { makeNode, type EffectDef, type GraphEdge } from '../sim';

/* Pure modulation-graph queries + mutators (the target-param discovery / exposure / mapping
   bookkeeping the store applies onto live nodes/edges). Store-level wiring is covered in
   store.modulation.test.ts; this locks the maths in isolation, free of runes. */

const effect: EffectDef = {
  id: 'swirl',
  name: 'Swirl',
  busId: 'b',
  scope: 'kit',
  attackMs: 0,
  sustainMs: 0,
  releaseMs: 0,
  params: [
    { key: 'size', label: 'Size', kind: 'number', min: 0, max: 1, default: 0.5 },
    { key: 'hue', label: 'Hue', kind: 'number', min: 0, max: 360, default: 0 },
    { key: 'blend', label: 'Blend', kind: 'enum', options: ['a', 'b'], default: 'a' }, // excluded (non-number)
  ],
};

describe('modTargetSpecs', () => {
  it('maps a play/effect node to its resolved effect number params', () => {
    const node = makeNode('play', 'p', 0, 0, { effectId: 'swirl' });
    expect(modTargetSpecs(node, effect)).toEqual([
      { key: 'size', label: 'Size', min: 0, max: 1 },
      { key: 'hue', label: 'Hue', min: 0, max: 360 },
    ]);
  });
  it('returns [] for a play node with no resolved effect', () => {
    expect(modTargetSpecs(makeNode('play', 'p'), undefined)).toEqual([]);
  });
  it('reads a modifier node purely from listModifiers()', () => {
    const node = makeNode('modifier', 'm', 0, 0, { modifierId: 'trail' });
    expect(modTargetSpecs(node, undefined)).toEqual([{ key: 'decayMs', label: 'Decay', min: 0, max: 4000 }]);
  });
  it('returns [] for a non-param node', () => {
    expect(modTargetSpecs(makeNode('switch', 's'), undefined)).toEqual([]);
  });
});

describe('modInputsOf', () => {
  it('returns the exposed rows, or [] when unset', () => {
    expect(modInputsOf(makeNode('play', 'p'))).toEqual([]);
    expect(modInputsOf(makeNode('play', 'p', 0, 0, { modInputs: [{ param: 'size' }] }))).toEqual([{ param: 'size' }]);
  });
});

describe('availableModParams', () => {
  it('excludes already-exposed params', () => {
    const node = makeNode('play', 'p', 0, 0, { effectId: 'swirl', modInputs: [{ param: 'size' }] });
    expect(availableModParams(node, effect)).toEqual([{ key: 'hue', label: 'Hue' }]);
  });
});

describe('addModInput', () => {
  it('appends a new param without mutating the input', () => {
    const cur = [{ param: 'size' }];
    expect(addModInput(cur, 'hue')).toEqual([{ param: 'size' }, { param: 'hue' }]);
    expect(cur).toEqual([{ param: 'size' }]); // input untouched
  });
  it('treats undefined as empty', () => {
    expect(addModInput(undefined, 'size')).toEqual([{ param: 'size' }]);
  });
  it('returns null (no-op) when already exposed', () => {
    expect(addModInput([{ param: 'size' }], 'size')).toBeNull();
  });
});

describe('removeModInput / edgesWithoutParamWires', () => {
  it('drops the row and the incoming param wires', () => {
    const modInputs = [{ param: 'size' }, { param: 'hue' }];
    expect(removeModInput(modInputs, 'size')).toEqual([{ param: 'hue' }]);
    expect(removeModInput(undefined, 'size')).toEqual([]);
    const edges: GraphEdge[] = [
      { id: 'e1', from: 'cc', to: 'p', toPort: 'param:size' }, // dropped
      { id: 'e2', from: 'cc', to: 'p', toPort: 'param:hue' }, // kept
      { id: 'e3', from: 'cc', to: 'other', toPort: 'param:size' }, // different target — kept
    ];
    expect(edgesWithoutParamWires(edges, 'p', 'size').map((e) => e.id)).toEqual(['e2', 'e3']);
  });
});

describe('mappingsFor', () => {
  it('returns only the incoming wires on the node/param port', () => {
    const edges: GraphEdge[] = [
      { id: 'e1', from: 'cc', to: 'p', toPort: 'param:size' },
      { id: 'e2', from: 'lfo', to: 'p', toPort: 'param:size' },
      { id: 'e3', from: 'cc', to: 'p', toPort: 'param:hue' }, // different param
    ];
    expect(mappingsFor(edges, 'p', 'size').map((e) => e.id)).toEqual(['e1', 'e2']);
  });
});

describe('modSourcesFor', () => {
  it('resolves each source wire, carrying its invert, and skips dangling/non-source wires', () => {
    const nodes = [
      makeNode('cc', 'cc', 0, 0, { ccController: 7, ccChannel: null }),
      makeNode('play', 'pl'), // play is not a mod source → skipped
      makeNode('play', 'p'),
    ];
    const edges: GraphEdge[] = [
      { id: 'e1', from: 'cc', to: 'p', toPort: 'param:size', invert: true },
      { id: 'e2', from: 'pl', to: 'p', toPort: 'param:size' }, // non-source → skipped
      { id: 'e3', from: 'missing', to: 'p', toPort: 'param:size' }, // dangling → skipped
      { id: 'e4', from: 'cc', to: 'p', toPort: 'param:hue' }, // different param
    ];
    const out = modSourcesFor(nodes, edges, 'p', 'size');
    expect(out).toHaveLength(1);
    expect(out[0]!.invert).toBe(true);
    expect(out[0]!.source).toEqual({ kind: 'cc', controller: 7, channel: null });
  });
});
