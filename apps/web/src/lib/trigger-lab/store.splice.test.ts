import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';
import { toastStore } from '../ui/toast.svelte';

/* R08 — dropping a node onto an existing wire splices it in: the wire `source → target`
   becomes `source → node → target`. The splice is its OWN undo checkpoint recorded AFTER the
   drag's position commit, so one Ctrl/Z pops the wiring while the node stays where it was
   dropped. Only plain trigger-FLOW wires splice (not mod / modulation wires), and only when
   both resulting wires are legal. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const fakeClient = (): WSClient =>
  ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
  toastStore.clear();
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  toastStore.clear();
});

/** A fresh store on a new (empty Gen3) authored graph — one trigger + one Output anchor, no edges. */
function freshGraph(): TriggerLab {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  return store;
}

const graphOf = (store: TriggerLab) => store.selectedGraph!;
const outputId = (store: TriggerLab) => graphOf(store).nodes.find((n) => n.kind === 'output')!.id;
const edgeBetween = (store: TriggerLab, from: string, to: string) =>
  graphOf(store).edges.find((e) => e.from === from && e.to === to);

/** Build `effect --wire--> output` (via the R04 auto-wire) plus a free Mix node to splice in.
    Mix has a flow in+out and does NOT auto-wire, so it is a clean splice payload. */
function graphWithFlowWireAndFreeNode(): {
  store: TriggerLab;
  effectId: string;
  mixId: string;
  edgeId: string;
} {
  const store = freshGraph();
  const effect = store.addNode('effect', 200, 0)!; // auto-wires effect → output
  const mix = store.addNode('mix', 400, 0)!; // no auto-wire
  toastStore.clear(); // drop the auto-wire toast so splice-toast assertions are clean
  const edge = edgeBetween(store, effect.id, outputId(store))!;
  return { store, effectId: effect.id, mixId: mix.id, edgeId: edge.id };
}

describe('wire-splice on drop (R08)', () => {
  it('splices source → node → target and removes the old wire', () => {
    const { store, effectId, mixId, edgeId } = graphWithFlowWireAndFreeNode();
    const out = outputId(store);
    expect(edgeBetween(store, effectId, out)).toBeDefined(); // the wire we splice into

    const ok = store.spliceOnDrop(edgeId, mixId);

    expect(ok).toBe(true);
    expect(graphOf(store).edges.some((e) => e.id === edgeId)).toBe(false); // old wire gone
    expect(edgeBetween(store, effectId, mixId)).toBeDefined(); // source → node
    expect(edgeBetween(store, mixId, out)).toBeDefined(); // node → target
  });

  it('preserves the source band port and the target input port across the splice', () => {
    const store = freshGraph();
    const out = outputId(store);
    // A switch node emits banded outputs; wire band-1 → output, then splice a Mix onto that wire.
    const sw = store.addNode('switch', 120, 0)!;
    expect(store.connect(sw.id, out, 'band-1')).toBeNull();
    const mix = store.addNode('mix', 400, 0)!;
    const edge = graphOf(store).edges.find((e) => e.from === sw.id && e.to === out)!;

    expect(store.spliceOnDrop(edge.id, mix.id)).toBe(true);

    // source → node keeps the band-1 source port; node → target lands on the flow input.
    const upstream = edgeBetween(store, sw.id, mix.id)!;
    const downstream = edgeBetween(store, mix.id, out)!;
    expect(upstream.fromPort).toBe('band-1');
    expect(downstream.toPort).toBeUndefined();
  });

  it('records the splice as ONE undo entry (remove + two connects fold together)', () => {
    const { store, effectId, mixId, edgeId } = graphWithFlowWireAndFreeNode();
    const out = outputId(store);

    store.spliceOnDrop(edgeId, mixId);
    expect(edgeBetween(store, effectId, mixId)).toBeDefined();
    expect(edgeBetween(store, mixId, out)).toBeDefined();

    expect(store.undo()).toBe(true);

    // one undo reverts the WHOLE splice — original wire back, both new wires gone
    expect(edgeBetween(store, effectId, out)).toBeDefined();
    expect(edgeBetween(store, effectId, mixId)).toBeUndefined();
    expect(edgeBetween(store, mixId, out)).toBeUndefined();
  });

  it('undo after a drag-then-splice pops the wiring but KEEPS the node position', () => {
    const { store, effectId, mixId, edgeId } = graphWithFlowWireAndFreeNode();
    const out = outputId(store);
    const mix = graphOf(store).nodes.find((n) => n.id === mixId)!;

    // The real gesture: commit the drop position FIRST (its own undo entry), THEN splice.
    store.moveNode(mix, 300, 140);
    store.spliceOnDrop(edgeId, mixId);
    expect(mix.x).toBe(300);
    expect(mix.y).toBe(140);

    // First undo: pops the splice wiring only.
    expect(store.undo()).toBe(true);
    expect(edgeBetween(store, effectId, out)).toBeDefined(); // wire un-spliced
    expect(edgeBetween(store, effectId, mixId)).toBeUndefined();
    const afterUndo = graphOf(store).nodes.find((n) => n.id === mixId)!;
    expect(afterUndo.x).toBe(300); // node stayed where it was dropped
    expect(afterUndo.y).toBe(140);

    // Second undo: now the position reverts (separate entry).
    expect(store.undo()).toBe(true);
    const afterSecond = graphOf(store).nodes.find((n) => n.id === mixId)!;
    expect(afterSecond.x).toBe(400);
    expect(afterSecond.y).toBe(0);
  });

  it('announces the splice with one info toast', () => {
    const { store, mixId, edgeId } = graphWithFlowWireAndFreeNode();
    store.spliceOnDrop(edgeId, mixId);
    expect(toastStore.items).toHaveLength(1);
    expect(toastStore.items[0]!.tone).toBe('info');
    expect(toastStore.items[0]!.message).toMatch(/splic/i);
  });

  describe('canSplice guard (read-only mirror the view arms on)', () => {
    it('accepts a legal flow-wire splice', () => {
      const { store, mixId, edgeId } = graphWithFlowWireAndFreeNode();
      expect(store.canSplice(edgeId, mixId)).toBe(true);
    });

    it('refuses splicing a node into its own wire', () => {
      const { store, effectId, edgeId } = graphWithFlowWireAndFreeNode();
      expect(store.canSplice(edgeId, effectId)).toBe(false); // effect is the wire's source
    });

    it('refuses a node that cannot legally sit in the flow (a modulation source)', () => {
      const { store, edgeId } = graphWithFlowWireAndFreeNode();
      // An envelope is a modulation source: it has no flow input/output, so source → envelope
      // → target is illegal — no splice.
      const env = store.addNode('envelope', 400, 200)!;
      expect(store.canSplice(edgeId, env.id)).toBe(false);
    });

    it('refuses splicing into a modulation wire (flow wires only)', () => {
      const store = freshGraph();
      // envelope --(param)--> effect is a modulation wire, not a flow wire.
      const effect = store.addNode('effect', 200, 0)!;
      const env = store.addNode('envelope', 0, 0)!;
      const key = store.availableModParams(effect)[0]!.key;
      expect(store.connect(env.id, effect.id, undefined, `param:${key}`)).toBeNull();
      const modWire = graphOf(store).edges.find((e) => e.from === env.id && e.to === effect.id)!;
      const mix = store.addNode('mix', 400, 0)!;

      expect(store.canSplice(modWire.id, mix.id)).toBe(false);
      expect(store.spliceOnDrop(modWire.id, mix.id)).toBe(false); // and the mutation no-ops
    });

    it('spliceOnDrop no-ops (returns false, no toast) for an unknown edge', () => {
      const { store, mixId } = graphWithFlowWireAndFreeNode();
      expect(store.spliceOnDrop('does-not-exist', mixId)).toBe(false);
      expect(toastStore.items).toHaveLength(0);
    });
  });
});
