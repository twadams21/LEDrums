import { describe, expect, it } from 'vitest';
import { compileRenderPlan } from './render-plan';
import type { GraphEdge, GraphNode, NodeKind, TriggerGraph } from './types';

function node(kind: NodeKind, id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    noRepeat: true,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    delayMode: 'time',
    ms: 0,
    division: '1/8',
    ...over,
  };
}

const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({ id, from, to, ...over });

/** Ids the compiler flags with an `empty-scope` finding, in issue order. */
function emptyScopeIds(graph: TriggerGraph): Array<string | undefined> {
  return compileRenderPlan(graph)
    .issues.filter((i) => i.code === 'empty-scope')
    .map((i) => i.nodeId);
}

describe('empty-scope lint', () => {
  it('flags an Output whose explicit drum cannot intersect the effect it collects', () => {
    // effect scoped to `kick` → Output scoped to `snare`: nothing this effect emits reaches Output.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'drum', targetId: 'kick' }),
        node('output', 'output', { scope: 'drum', targetId: 'snare' }),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-output', 'fx', 'output')],
    };

    expect(emptyScopeIds(graph)).toEqual(['output']);
    // Empty-scope is a per-branch warning, never fatal — the plan still compiles.
    expect(compileRenderPlan(graph).fatal).toBe(false);
  });

  it('flags a Scope node whose target is disjoint from the upstream effect scope', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'drum', targetId: 'kick' }),
        node('scope', 'sc', { scope: 'drum', targetId: 'snare' }),
        node('output', 'output'),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-sc', 'fx', 'sc'), edge('sc-output', 'sc', 'output')],
    };

    expect(emptyScopeIds(graph)).toEqual(['sc']);
  });

  it('does not flag a bare (firing-drum) scope against a concrete drum — it may coincide at runtime', () => {
    // effect on `kick` → Scope with scope:drum but NO target (resolves to the firing drum).
    // At runtime the firing drum could be `kick`, so the intersection is not provably empty.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'drum', targetId: 'kick' }),
        node('scope', 'sc', { scope: 'drum', targetId: undefined }),
        node('output', 'output'),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-sc', 'fx', 'sc'), edge('sc-output', 'sc', 'output')],
    };

    expect(emptyScopeIds(graph)).toEqual([]);
  });

  it('flags disjoint hoop indices even when one drum is the firing-drum wildcard', () => {
    // hoop {1} on the firing drum, then hoop {2} on `kick`: same-drum needs overlapping hoops
    // (there are none) and different-drum is empty too — empty for EVERY source drum.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'hoop', targetId: '#1' }),
        node('scope', 'sc', { scope: 'hoop', targetId: 'kick#2' }),
        node('output', 'output'),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-sc', 'fx', 'sc'), edge('sc-output', 'sc', 'output')],
    };

    expect(emptyScopeIds(graph)).toEqual(['sc']);
  });

  it('does not flag overlapping hoop selections on the same drum', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'hoop', targetId: 'kick#0,1,2' }),
        node('output', 'output', { scope: 'hoop', targetId: 'kick#1' }),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-output', 'fx', 'output')],
    };

    expect(emptyScopeIds(graph)).toEqual([]);
  });

  it('treats whole-kit as identity, never a reset', () => {
    // effect on `kick` → kit Scope → Output on `kick`: kit narrows nothing, so this stays alive.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'drum', targetId: 'kick' }),
        node('scope', 'sc', { scope: 'kit' }),
        node('output', 'output', { scope: 'drum', targetId: 'kick' }),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-sc', 'fx', 'sc'), edge('sc-output', 'sc', 'output')],
    };

    expect(emptyScopeIds(graph)).toEqual([]);
  });

  it('clears a node once a Mix upstream resets the scope to whole-kit', () => {
    // effect on `kick` → Mix (resets to kit) → Output on `snare`: after the Mix the stream is
    // kit again, so the `snare` Output can light. No empty-scope.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'drum', targetId: 'kick' }),
        node('mix', 'mx'),
        node('output', 'output', { scope: 'drum', targetId: 'snare' }),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-mx', 'fx', 'mx'), edge('mx-output', 'mx', 'output')],
    };

    expect(emptyScopeIds(graph)).toEqual([]);
  });

  it('keeps a node alive when at least one incoming stream can reach it', () => {
    // Two effects into one Output on `kick`: fxA(`snare`) is dead there, but fxB(`kick`) is live —
    // so the Output is NOT flagged (a single live stream keeps it off the list).
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fxA', { effectId: 'plasma', scope: 'drum', targetId: 'snare' }),
        node('effect', 'fxB', { effectId: 'plasma', scope: 'drum', targetId: 'kick' }),
        node('output', 'output', { scope: 'drum', targetId: 'kick' }),
      ],
      edges: [
        edge('trigger-fxA', 'trigger', 'fxA'),
        edge('trigger-fxB', 'trigger', 'fxB'),
        edge('fxA-output', 'fxA', 'output'),
        edge('fxB-output', 'fxB', 'output'),
      ],
    };

    expect(emptyScopeIds(graph)).toEqual([]);
  });

  // INIT-06 S13 — CHARACTERISATION, written before the fix and green at HEAD to prove the
  // divergence is real rather than a reading of the code.
  //
  // scope-lint.ts carried a FIFTH hand-rolled copy of the hoop-target grammar, and it had not
  // been moved to the post-A1 1-based world: it filtered `v >= 0`, admitting hoop index 0, where
  // scope.ts's resolver policy filters `v >= 1` and falls back to the unmatchable `[-1]`.
  //
  // Consequence: `"kick#0"` resolves at RUNTIME to the empty sentinel and renders nothing, but
  // the lint saw hoop {0} and let it intersect, so the branch read as alive — a false negative in
  // exactly the diagnostic that exists to surface wired-but-inert branches.
  it('flags a hoop-0 target as provably empty (post-A1: hoops are 1-based)', () => {
    // effect {0,1,2} → Output {0}. Runtime: {1,2} ∩ [-1] = ∅, the play is dropped and nothing
    // lights. Before the fix the lint computed {0,1,2} ∩ {0} = {0} and stayed silent.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'hoop', targetId: 'kick#0,1,2' }),
        node('output', 'output', { scope: 'hoop', targetId: 'kick#0' }),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-output', 'fx', 'output')],
    };

    expect(emptyScopeIds(graph)).toEqual(['output']);
    expect(compileRenderPlan(graph).fatal).toBe(false);
  });

  // A SECOND divergence, found while routing the parse through scope.ts and not named in the
  // plan: the private parse gave a bare (auto) hoop target `hoops: [0]`, while the resolver
  // policy gives `[1]` — a bare hoop target resolves to hoop 1 of the firing drum at runtime.
  // Since 0 matches no real hoop, the lint would have called a perfectly live bare hoop branch
  // provably empty: a false POSITIVE, the opposite failure to the one above. No existing
  // expectation covered a bare hoop target, so nothing in the suite encoded it on purpose.
  it('does not flag a bare (auto) hoop target against hoop 1 — it resolves there at runtime', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'hoop' }), // no targetId → auto
        node('output', 'output', { scope: 'hoop', targetId: 'kick#1' }),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-output', 'fx', 'output')],
    };

    expect(emptyScopeIds(graph)).toEqual([]);
  });

  it('flags a chain empty only via a three-way hoop intersection', () => {
    // hoop {1,2} → hoop {2,3} → Output hoop {1,3} on one drum: pairwise all overlap, but the
    // running intersection is {2} then ∅ — the accumulation (not pairwise) catches it.
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        node('trigger', 'trigger'),
        node('effect', 'fx', { effectId: 'plasma', scope: 'hoop', targetId: 'kick#1,2' }),
        node('scope', 'sc', { scope: 'hoop', targetId: 'kick#2,3' }),
        node('output', 'output', { scope: 'hoop', targetId: 'kick#1,3' }),
      ],
      edges: [edge('trigger-fx', 'trigger', 'fx'), edge('fx-sc', 'fx', 'sc'), edge('sc-output', 'sc', 'output')],
    };

    // `sc` stays alive ({2}); only the Output's {1,3} misses the surviving {2}.
    expect(emptyScopeIds(graph)).toEqual(['output']);
  });
});
