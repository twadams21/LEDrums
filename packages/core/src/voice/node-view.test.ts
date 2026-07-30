import { describe, expect, it } from 'vitest';
import { narrowNode, type NodeView, type NodeViewOf } from './node-view';
import type { GraphNode, NodeKind } from './types';

/**
 * PER-KIND FIELD USAGE — the assertion the vacuous `_Sound` check could never make.
 *
 * For each kind, the `GraphNode` fields that site-level code ACTUALLY READS once it has
 * established that kind. Each arm of `NodeView` must be a SUPERSET of its kind's entry here,
 * so an arm that forgets a field its consumers read fails the build. This is the check that
 * would have caught the projection's `cc` arm omitting `ccSource`/`oscAddress` and its
 * `modifier` arm omitting `bypass` (primitive-obsession-0009).
 *
 * The table lives in the TEST, not next to the type: it is a record of observed usage in the
 * tree, which is exactly the thing the type must not be allowed to define for itself.
 *
 * Provenance for every entry is a real read site, listed per kind below. Fields reachable on
 * EVERY kind (`id`, `kind`, `x`, `y` — the projection's shared `base`, computed on the flat
 * record before dispatch) live in `Base` and are not repeated here.
 */
const FIELD_USAGE = {
  // engine.ts:867 + store.svelte.ts:2079 read `.source` after `kind === 'trigger'`.
  trigger: ['source'],

  // No structural fields — `baseOnly` in the projection's KIND_SIG; eval reads children only.
  all: [],
  sequence: [],
  toggle: [],

  // eval-graph.ts `case 'random'` reads noRepeat; ContainerNodeInspector edits it.
  random: ['noRepeat'],
  // eval-graph.ts `case 'chance'` reads p; ContainerNodeInspector edits it.
  chance: ['p'],
  // eval-graph.ts `case 'switch'` + KIND_SIG switch + ContainerNodeInspector.
  switch: ['on', 'valueMode', 'threshold', 'invert', 'bands'],
  // eval-graph.ts `case 'delay'` computeDelayMs args; DelayNodeInspector edits all three.
  delay: ['delayMode', 'ms', 'division'],

  // makePlayDraft (eval-graph.ts:233) reads effectId/playType/canvasScene/mode/scope/targetId/
  // busId/params; resolveNodeModulations reads env + modInputs; PlayNodeInspector reads
  // presetId. KIND_SIG's effectSig reads playType/effectId/canvasScene.
  effect: ['mode', 'scope', 'targetId', 'effectId', 'playType', 'canvasScene', 'presetId', 'busId', 'params', 'env', 'modInputs'],

  // modifier-graph.ts:33/36/55/56 read modifierId/env/params/bypass; ModifierNodeInspector
  // edits bypass/modifierId/params; modulation wires land on modInputs.
  modifier: ['modifierId', 'bypass', 'params', 'env', 'modInputs'],
  // eval-graph.ts mix case + KIND_SIG mix.
  mix: ['mixBlendMode'],

  // ScopeNodeInspector / OutputNodeInspector + eval-graph.ts:517 intersectScopeTargets.
  scope: ['scope', 'targetId'],
  output: ['scope', 'targetId'],

  // nodeModSource's six builders (modulation-graph.ts:63-91) — one entry per MOD_SOURCE_KIND.
  envelope: ['env'],
  lfo: ['lfo'],
  // controller/channel from nodeModSource; ccSource from store.svelte.ts:3205 `ccNodeSource`
  // (a cc node's live-input mode). oscAddress is read off a `cc` node by hydrate.ts:363-365,
  // which migrates a persisted `cc` + ccSource:'osc' node to kind `osc` carrying its address.
  cc: ['ccController', 'ccChannel', 'ccSource', 'oscAddress'],
  note: ['noteNumber', 'noteChannel', 'noteMode', 'noteReleaseMs'],
  osc: ['oscAddress'],
  randomMod: ['randomDistribution', 'randomSteps'],
} as const satisfies Record<NodeKind, readonly (keyof GraphNode)[]>;

type Assert<T extends true> = T;

/** Fields a kind's consumers read that its arm does not carry — must be `never` for every kind. */
type MissingFor<K extends NodeKind> = Exclude<(typeof FIELD_USAGE)[K][number], keyof NodeViewOf<K>>;

/** The kinds whose arm is NOT a superset of their observed usage. Surfaced as a union of kind
    names rather than a bare boolean so the compile error names the offender. */
type UnderCoveredKinds = { [K in NodeKind]: [MissingFor<K>] extends [never] ? never : K }[NodeKind];

type _Superset = Assert<[UnderCoveredKinds] extends [never] ? true : false>;
export type { _Superset };

/** A GraphNode with EVERY field populated with a distinguishable value, so a view that dropped
    or transformed a field would show up as a mismatch rather than as an identical default. */
function fullNode(kind: NodeKind): GraphNode {
  return {
    id: `n-${kind}`, kind, x: 11, y: 22,
    mode: 'loop', scope: 'hoop', targetId: 'tom1#2', effectId: 'fx-1', playType: 'canvas',
    canvasScene: 'scene-1', presetId: 'preset-1', busId: 'bus-1',
    params: { size: 0.75 }, env: { shape: { kind: 'decay', amount: 1, points: [] } },
    modifierId: 'mod-1', bypass: true, mixBlendMode: 'add', modInputs: [{ param: 'size' }],
    lfo: { waveform: 'sine', rateMode: 'hz', rateHz: 2, division: '1/4', phase: 0.25, depth: 1 },
    ccController: 7, ccChannel: 3, ccSource: 'osc', oscAddress: '/live/1',
    noteNumber: 64, noteChannel: 9, noteMode: 'velocity', noteReleaseMs: 120,
    randomDistribution: 'gaussian', randomSteps: 8,
    noRepeat: true, on: 'value', valueMode: 'bands', threshold: 0.4, invert: true, bands: [0.3, 0.7],
    p: 0.9, delayMode: 'beats', ms: 250, division: '1/8',
    source: { kind: 'midi', note: 60 },
  } as GraphNode;
}

const KINDS = Object.keys(FIELD_USAGE) as NodeKind[];

describe('NodeView', () => {
  it('narrows without copying — the view IS the record, not a projection of it', () => {
    for (const kind of KINDS) {
      const record = fullNode(kind);
      const view: NodeView = narrowNode(record);
      // Same object identity: narrowNode is a cast, so it allocates nothing on any hot path.
      expect(view).toBe(record);
      expect(view.kind).toBe(kind);
    }
  });

  it('every field a kind is documented to read is readable on that kind, with the record value', () => {
    for (const kind of KINDS) {
      const record = fullNode(kind);
      const view = narrowNode(record) as unknown as Record<string, unknown>;
      for (const field of FIELD_USAGE[kind] as readonly string[]) {
        // Present as an own property AND identical to the record's value — a view that dropped
        // or rewrote a field would fail here even though the types would still line up.
        expect(Object.hasOwn(record, field)).toBe(true);
        expect(view[field]).toStrictEqual((record as unknown as Record<string, unknown>)[field]);
      }
    }
  });

  it('the usage table covers every kind exactly once', () => {
    expect(new Set(KINDS).size).toBe(KINDS.length);
    // Totality against the union itself is `_Total` in node-view.ts (a compile error, not a
    // test); this pins the TABLE to the same length so a kind cannot be added to the union and
    // its arm without anyone recording what that kind actually reads.
    expect(KINDS.length).toBe(19); // 20 before 06C dropped the legacy `play` alias arm
  });
});
