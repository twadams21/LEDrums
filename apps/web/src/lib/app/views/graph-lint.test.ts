import { describe, it, expect } from 'vitest';
import { voice } from '@ledrums/core';
import { lintEntries, lintEntriesByNode, nodeLintEntries } from './graph-lint';
import { makeNode, type TriggerGraph } from '../../trigger-lab/sim';

/* Component-seam test (R05 / GH #84): the lint strip's copy is produced by `lintEntries`
   from the render-plan compiler's real `issues`. We compile degenerate graphs so the codes
   are genuine compiler output, then assert the presentation contract: one entry per issue,
   each stating a plain problem AND a next step, order preserved, cycle detail surfaced. */

function graph(nodes: TriggerGraph['nodes'], edges: TriggerGraph['edges'] = []): TriggerGraph {
  return { version: 3, nodes, edges };
}

const trigger = makeNode('trigger', 'trigger', 0, 0);
const output = makeNode('output', 'output', 400, 0);
const route = (id: string, y = 0) => makeNode('all', id, 200, y);

describe('lintEntries', () => {
  it('is empty for a well-formed graph (strip absent)', () => {
    const plan = voice.compileRenderPlan(graph([trigger, output]));
    expect(plan.issues).toHaveLength(0);
    expect(lintEntries(plan.issues)).toEqual([]);
  });

  it('surfaces a missing trigger with a problem AND a next step', () => {
    const plan = voice.compileRenderPlan(graph([output]));
    const entries = lintEntries(plan.issues);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.code).toBe('missing-trigger');
    expect(entries[0]!.problem).toBeTruthy();
    expect(entries[0]!.action).toMatch(/trigger source/i);
    // The action names the next step, not just the fault.
    expect(entries[0]!.action).not.toBe(entries[0]!.problem);
  });

  it('surfaces a missing output', () => {
    const plan = voice.compileRenderPlan(graph([trigger]));
    const entries = lintEntries(plan.issues);
    expect(entries.map((e) => e.code)).toContain('missing-output');
    const out = entries.find((e) => e.code === 'missing-output')!;
    expect(out.action).toMatch(/output/i);
  });

  it('preserves compiler order across multiple issues', () => {
    // No trigger and no output → both issues, trigger first (compile order).
    const plan = voice.compileRenderPlan(graph([route('a')]));
    const entries = lintEntries(plan.issues);
    expect(entries.map((e) => e.code)).toEqual(plan.issues.map((i) => i.code));
    expect(entries[0]!.code).toBe('missing-trigger');
  });

  it('carries the cycle path as detail (prefix stripped) and the node it points at', () => {
    const a = route('a', 0);
    const b = route('b', 100);
    // a -> b -> a is a flow cycle.
    const cyclic = graph(
      [trigger, output, a, b],
      [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'a' },
      ],
    );
    const plan = voice.compileRenderPlan(cyclic);
    const cycle = plan.issues.find((i) => i.code === 'flow-cycle');
    expect(cycle).toBeTruthy();
    const entry = lintEntries(plan.issues).find((e) => e.code === 'flow-cycle')!;
    expect(entry.action).toMatch(/wire/i);
    expect(entry.detail).toBeTruthy();
    expect(entry.detail).not.toMatch(/Flow cycle rejected/); // dev prefix dropped
    expect(entry.detail).not.toMatch(/\.$/); // trailing period trimmed
    expect(entry.nodeId).toBe(cycle!.nodeId);
  });

  it('surfaces a no-path-to-output finding anchored to the render leaf with a next step', () => {
    // effect fired by the trigger but never wired onward to Output (R07 — the unwired render leaf).
    const fx = makeNode('effect', 'fx', 200, 0, { effectId: 'plasma' });
    const plan = voice.compileRenderPlan(graph([trigger, fx, output], [{ id: 't-fx', from: 'trigger', to: 'fx' }]));
    const issue = plan.issues.find((i) => i.code === 'no-path-to-output');
    expect(issue).toBeTruthy();
    expect(issue!.nodeId).toBe('fx');
    const entry = lintEntries(plan.issues).find((e) => e.code === 'no-path-to-output')!;
    expect(entry.problem).toMatch(/output/i);
    expect(entry.action).toMatch(/output/i);
    expect(entry.action).not.toBe(entry.problem); // names the fix, not just the fault
    expect(entry.nodeId).toBe('fx');
  });

  it('surfaces a dead-branch finding anchored to the producerless branch head with a next step', () => {
    // trigger -> route -> Output: a branch reaching Output with no producer to render (R07).
    const rt = route('rt');
    const plan = voice.compileRenderPlan(
      graph([trigger, rt, output], [
        { id: 't-rt', from: 'trigger', to: 'rt' },
        { id: 'rt-out', from: 'rt', to: 'output' },
      ]),
    );
    const issue = plan.issues.find((i) => i.code === 'dead-branch');
    expect(issue).toBeTruthy();
    expect(issue!.nodeId).toBe('output');
    const entry = lintEntries(plan.issues).find((e) => e.code === 'dead-branch')!;
    expect(entry.problem).toBeTruthy();
    expect(entry.action).toMatch(/effect|play|layer/i);
    expect(entry.action).not.toBe(entry.problem);
    expect(entry.nodeId).toBe('output');
  });

  it('surfaces an empty-scope finding anchored to the offending node with a next step', () => {
    // effect scoped to `kick` → Output scoped to `snare`: the effective scope is empty (R06).
    const fx = makeNode('effect', 'fx', 200, 0, { effectId: 'plasma', scope: 'drum', targetId: 'kick' });
    const out = makeNode('output', 'output', 400, 0, { scope: 'drum', targetId: 'snare' });
    const plan = voice.compileRenderPlan(graph([trigger, fx, out], [{ id: 'fx-out', from: 'fx', to: 'output' }]));
    const empty = plan.issues.find((i) => i.code === 'empty-scope');
    expect(empty).toBeTruthy();
    expect(empty!.nodeId).toBe('output');
    const entry = lintEntries(plan.issues).find((e) => e.code === 'empty-scope')!;
    expect(entry.problem).toBeTruthy();
    expect(entry.action).toBeTruthy();
    expect(entry.action).not.toBe(entry.problem); // names the fix, not just the fault
    expect(entry.nodeId).toBe('output');
  });
});

describe('nodeLintEntries (inspector row model, R15)', () => {
  const fxUnwired = () => {
    // effect fired by the trigger but never wired onward to Output → 'fx' carries no-path-to-output.
    const fx = makeNode('effect', 'fx', 200, 0, { effectId: 'plasma' });
    return voice.compileRenderPlan(graph([trigger, fx, output], [{ id: 't-fx', from: 'trigger', to: 'fx' }]));
  };

  it('returns only the entries anchored to the given node', () => {
    const entries = nodeLintEntries(fxUnwired().issues, 'fx');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.nodeId === 'fx')).toBe(true);
    expect(entries.map((e) => e.code)).toContain('no-path-to-output');
  });

  it('narrows to a code set when one is given', () => {
    const issues = fxUnwired().issues;
    expect(nodeLintEntries(issues, 'fx', ['no-path-to-output']).map((e) => e.code)).toEqual(['no-path-to-output']);
    expect(nodeLintEntries(issues, 'fx', ['dead-branch'])).toEqual([]); // fx carries no dead-branch
  });

  it('returns [] for a node with no findings', () => {
    const plan = voice.compileRenderPlan(graph([trigger, output]));
    expect(nodeLintEntries(plan.issues, 'output')).toEqual([]);
  });
});

describe('lintEntriesByNode (strip ↔ badge agreement)', () => {
  it('groups anchored findings by node, referencing the SAME entries the strip renders', () => {
    // Two anchored findings on different nodes: a flow cycle (route `a`) and an empty scope (output).
    const a = route('a', 0);
    const b = route('b', 100);
    const fx = makeNode('effect', 'fx', 300, 0, { effectId: 'plasma', scope: 'drum', targetId: 'kick' });
    const out = makeNode('output', 'output', 500, 0, { scope: 'drum', targetId: 'snare' });
    const plan = voice.compileRenderPlan(
      graph([trigger, a, b, fx, out], [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'a' },
        { id: 'e3', from: 'fx', to: 'output' },
      ]),
    );
    const strip = lintEntries(plan.issues);
    const byNode = lintEntriesByNode(strip);

    // Every badge entry is one of the strip's entries (same object) — one lint model, two surfaces.
    for (const [nodeId, entries] of byNode) {
      for (const entry of entries) {
        expect(entry.nodeId).toBe(nodeId);
        expect(strip).toContain(entry);
      }
    }
    // The output's badge shows exactly its empty-scope finding.
    expect(byNode.get('output')?.map((e) => e.code)).toEqual(['empty-scope']);
    // Anchor-less findings (missing trigger/output) never appear on a badge.
    expect([...byNode.keys()]).not.toContain(undefined);
  });

  it('is empty when no finding carries a node id', () => {
    const plan = voice.compileRenderPlan(graph([output])); // missing-trigger only, no nodeId
    expect(lintEntriesByNode(lintEntries(plan.issues)).size).toBe(0);
  });
});
