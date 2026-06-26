import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { makeNode, type GraphNode, type SwitchOn, type TriggerGraph } from './sim';
import { STORAGE_KEY } from './persistence';
import type { WSClient } from '../ws/client';

/* Store-level coverage for the value-switch mutators + source-port wiring. These are
   the fiddly bits the pure sim tests can't reach: connect/reconnect carrying fromPort,
   the dup rule (same target via different bands is allowed), backfill on enter / strip
   on leave, and the band add/remove cutoff bookkeeping (clamp + port remap + dedup). */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const fakeClient = (): WSClient =>
  ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

/** Fresh store with an empty authored graph selected + a value/bands switch wired in. */
function withBandsSwitch(): { store: TriggerLab; sw: GraphNode; play: () => GraphNode } {
  const store = new TriggerLab(fakeClient);
  store.createGraph('test');
  const sw = store.addNode('switch', 200, 0)!;
  store.setSwitchOn(sw, 'value');
  store.setValueMode(sw, 'bands');
  let i = 0;
  const play = (): GraphNode => store.addNode('play', 400, (i++ - 1) * 50)!;
  return { store, sw, play };
}

const portsFrom = (store: TriggerLab, fromId: string): Array<string | undefined> =>
  store.selectedGraph!.edges.filter((e) => e.from === fromId).map((e) => e.fromPort);

describe('connect / reconnect with source ports', () => {
  it('records the source port on the edge', () => {
    const { store, sw, play } = withBandsSwitch();
    const a = play();
    store.connect(sw.id, a.id, 'band-0');
    expect(portsFrom(store, sw.id)).toEqual(['band-0']);
  });

  it('allows the same target from two different bands', () => {
    const { store, sw, play } = withBandsSwitch();
    const a = play();
    store.connect(sw.id, a.id, 'band-0');
    store.connect(sw.id, a.id, 'band-1');
    expect(portsFrom(store, sw.id).sort()).toEqual(['band-0', 'band-1']);
  });

  it('rejects a duplicate wire on the same port + target', () => {
    const { store, sw, play } = withBandsSwitch();
    const a = play();
    store.connect(sw.id, a.id, 'band-0');
    store.connect(sw.id, a.id, 'band-0');
    expect(portsFrom(store, sw.id)).toEqual(['band-0']);
  });

  it('reconnect re-points the edge AND updates its source port', () => {
    const { store, sw, play } = withBandsSwitch();
    const a = play();
    const b = play();
    store.connect(sw.id, a.id, 'band-0');
    const edge = store.selectedGraph!.edges.find((e) => e.from === sw.id)!;
    store.reconnect(edge.id, sw.id, b.id, 'band-1');
    const moved = store.selectedGraph!.edges.find((e) => e.id === edge.id)!;
    expect([moved.to, moved.fromPort]).toEqual([b.id, 'band-1']);
  });
});

describe('enter / leave value mode', () => {
  it('backfills value defaults when a switch first becomes a value switch', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('t');
    const sw = store.addNode('switch', 0, 0)!;
    // wipe the new fields as an old persisted node would lack them
    delete (sw as Partial<GraphNode>).valueMode;
    delete (sw as Partial<GraphNode>).bands;
    store.setSwitchOn(sw, 'value');
    expect(sw.valueMode).toBe('gate');
    expect(sw.threshold).toBe(0.5);
    expect(sw.invert).toBe(false);
    expect(sw.bands).toEqual([0.5]);
  });

  it('strips band ports when leaving value mode (collapse to default output)', () => {
    const { store, sw, play } = withBandsSwitch();
    const a = play();
    store.connect(sw.id, a.id, 'band-0');
    store.setSwitchOn(sw, 'section'); // leaving value mode (any non-value mode) strips band ports
    expect(portsFrom(store, sw.id)).toEqual([undefined]);
  });

  it('strips band ports when switching the value sub-mode to gate', () => {
    const { store, sw, play } = withBandsSwitch();
    const a = play();
    store.connect(sw.id, a.id, 'band-0');
    store.setValueMode(sw, 'gate');
    expect(portsFrom(store, sw.id)).toEqual([undefined]);
  });
});

describe('band cutoffs', () => {
  it('addBand splits the final band (a new cutoff between the last and 1)', () => {
    const { store, sw } = withBandsSwitch();
    expect(sw.bands).toEqual([0.5]);
    store.addBand(sw);
    expect(sw.bands).toEqual([0.5, 0.75]);
  });

  it('setBandCutoff clamps within neighbours (cutoffs never reorder)', () => {
    const { store, sw } = withBandsSwitch();
    store.setBandCutoff(sw, 0, 0.2);
    store.addBand(sw); // [0.2, 0.6]
    store.setBandCutoff(sw, 0, 0.9); // clamp to ≤ neighbour 0.6
    expect(sw.bands[0]).toBeCloseTo(0.6);
    store.setBandCutoff(sw, 1, 0.0); // clamp to ≥ neighbour 0.6
    expect(sw.bands[1]).toBeCloseTo(0.6);
  });

  it('keeps at least one cutoff (≥2 bands)', () => {
    const { store, sw } = withBandsSwitch();
    store.removeBand(sw, 0);
    expect(sw.bands).toEqual([0.5]); // refused
  });

  it('removeBand merges the higher band down and remaps edge ports', () => {
    const { store, sw, play } = withBandsSwitch();
    store.setBandCutoff(sw, 0, 0.3);
    store.addBand(sw); // [0.3, 0.65] → 3 bands: band-0, band-1, band-2
    const a = play();
    const b = play();
    const c = play();
    store.connect(sw.id, a.id, 'band-0');
    store.connect(sw.id, b.id, 'band-1');
    store.connect(sw.id, c.id, 'band-2');
    store.removeBand(sw, 1); // drop cutoff 1 → band-2 merges into band-1
    const ports = new Map(store.selectedGraph!.edges.filter((e) => e.from === sw.id).map((e) => [e.to, e.fromPort]));
    expect(ports.get(a.id)).toBe('band-0');
    expect(ports.get(b.id)).toBe('band-1');
    expect(ports.get(c.id)).toBe('band-1'); // shifted down into the merged band
    expect(sw.bands).toEqual([0.3]);
  });

  it('removeBand dedups wires that collide onto the same band + target', () => {
    const { store, sw, play } = withBandsSwitch();
    store.setBandCutoff(sw, 0, 0.3);
    store.addBand(sw); // 3 bands
    const a = play();
    store.connect(sw.id, a.id, 'band-1');
    store.connect(sw.id, a.id, 'band-2');
    store.removeBand(sw, 1); // band-2 → band-1, collides with the existing band-1 → a
    const toA = store.selectedGraph!.edges.filter((e) => e.from === sw.id && e.to === a.id);
    expect(toA).toHaveLength(1);
    expect(toA[0]!.fromPort).toBe('band-1');
  });
});

describe('velocity fold on hydrate', () => {
  it('folds a persisted on:velocity switch into value+bands on construction', () => {
    // a returning user's blob with a legacy `velocity` switch (2 children, no band ports)
    const graph: TriggerGraph = {
      nodes: [
        makeNode('trigger', 'trigger', 0, 0),
        makeNode('switch', 'sw', 200, 0, { on: 'velocity' as unknown as SwitchOn }),
        makeNode('play', 'a', 400, 0, { effectId: 'chase', presetId: 'chase:default' }),
        makeNode('play', 'b', 400, 100, { effectId: 'sparkle', presetId: 'sparkle:default' }),
      ],
      edges: [
        { id: 'e-t', from: 'trigger', to: 'sw' },
        { id: 'e0', from: 'sw', to: 'a' },
        { id: 'e1', from: 'sw', to: 'b' },
      ],
    };
    globalThis.localStorage!.setItem(STORAGE_KEY, JSON.stringify({ version: 1, data: { graphs: { 'kick:0': graph } } }));

    const store = new TriggerLab(fakeClient);
    const g = store.graphs['kick:0']!;
    const node = g.nodes.find((n) => n.id === 'sw')!;
    expect(node.on).toBe('value');
    expect(node.valueMode).toBe('bands');
    expect(node.bands).toEqual([0.5]); // 2 children → one even cutoff
    const ports = new Map(g.edges.filter((e) => e.from === 'sw').map((e) => [e.to, e.fromPort]));
    expect(ports.get('a')).toBe('band-0'); // y-order: a (y=0) → band-0, b (y=100) → band-1
    expect(ports.get('b')).toBe('band-1');
  });
});
