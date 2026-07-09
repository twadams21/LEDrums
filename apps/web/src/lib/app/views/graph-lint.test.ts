import { describe, it, expect } from 'vitest';
import { voice } from '@ledrums/core';
import { lintEntries } from './graph-lint';
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
});
