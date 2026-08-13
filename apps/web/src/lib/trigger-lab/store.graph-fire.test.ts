import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { graphFiredMonitorLabel, graphMonitorDestination } from '@ledrums/protocol';
import { TriggerLab } from './store.svelte';
import type { WSCallbacks, WSClient } from '../ws/client';
import type { MonitorEvent } from '../ws/protocol-types';

/* The graph-fire indicator's ONE signal (#177). Whatever fires a graph — the computer-keyboard
   performance path, an offline hardware-MIDI hit, or the SERVER's voice engine when connected —
   lands on `markGraphFire`, so the rail card has a single subscription. Connected, the server is
   the only thing that knows which graph a real drum hit played (it may belong to another song's
   section, the case that made this untraceable); its `graph fired` monitor event carries the key
   and is read back here. */

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

/** A client that hands back the handlers the store wires, so a test can play the server. */
function wiring(): { factory: () => WSClient; handlers: WSCallbacks } {
  const handlers: WSCallbacks = {};
  const client = {
    on(cb: WSCallbacks) {
      Object.assign(handlers, cb);
    },
    connect() {},
    close() {},
    send() {},
  } as unknown as WSClient;
  return { factory: () => client, handlers };
}

/** Run a body with a no-op rAF so start()/stop() work in node. */
function withRaf(body: () => void): void {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  try {
    body();
  } finally {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
  }
}

const graphEvent = (label: string, graphKey: string): MonitorEvent => ({
  id: 1,
  time: 0,
  type: 'graph',
  direction: 'local',
  source: 'server/voice',
  destination: graphMonitorDestination(graphKey),
  label,
});

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('graph fire signal', () => {
  it('a keyboard fire stamps both the fire clock and the card signal', () => {
    const { factory } = wiring();
    const store = new TriggerLab(factory);
    const key = store.createGraph('Strobe');
    store.addGraphToSection(store.activeSectionId!, key);

    store.fireSectionGraph(store.activeSection!.graphs.indexOf(key));

    expect(store.lastGraphFire?.key).toBe(key);
    expect(store.graphFireAt[key]).toBeGreaterThanOrEqual(0);
  });

  it("reads the server's graph-fired event back — including a graph this view never resolved", () => {
    const { factory, handlers } = wiring();
    const store = new TriggerLab(factory);
    withRaf(() => {
      store.start();
      // A graph key the local active section does NOT list: the "fired from another song" case.
      handlers.onMonitor!(graphEvent(graphFiredMonitorLabel('graph-elsewhere'), 'graph-elsewhere'));
      expect(store.lastGraphFire?.key).toBe('graph-elsewhere');

      const first = store.lastGraphFire!.seq;
      handlers.onMonitor!(graphEvent(graphFiredMonitorLabel('graph-elsewhere'), 'graph-elsewhere'));
      // A re-fire of the SAME key bumps seq, so the card can restart its flash.
      expect(store.lastGraphFire!.seq).toBeGreaterThan(first);
      store.stop();
    });
  });

  it('ignores graph events that are not fires (resolve / sequence reset)', () => {
    const { factory, handlers } = wiring();
    const store = new TriggerLab(factory);
    withRaf(() => {
      store.start();
      handlers.onMonitor!(graphEvent('Graph resolved graph-9', 'graph-9'));
      handlers.onMonitor!(graphEvent('Sequence reset graph-9', 'graph-9'));
      expect(store.lastGraphFire).toBeNull();
      store.stop();
    });
  });
});
