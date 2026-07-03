import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';
import type { VoiceStat } from '../ws/protocol-types';
import type { Voice } from './sim';

/* S17 — the Layers/Buses dock reads server-truth when connected. `store.dockVoices` source-selects
   between the streamed server voices (link open) and the local sim voices (offline); and while
   connected the sim's per-frame `snapshot()` must NOT clobber the server-streamed bus levels. */

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

const capturing = (sent: ClientMessage[]): (() => WSClient) =>
  () =>
    ({ on() {}, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient;

/** `snapshot()` is the private per-frame transient copy — reach it directly to prove the bus-level
    clobber guard without spinning a rAF loop. */
type Internals = { snapshot(): void };
const internals = (store: TriggerLab): Internals => store as unknown as Internals;

function simVoice(over: Partial<Voice> = {}): Voice {
  return {
    id: 'sv1',
    effectId: 'flash',
    pattern: 'flash',
    busId: 'base',
    mode: 'loop',
    scope: 'kit',
    sourceDrumId: null,
    velocity: 1,
    params: { hue: 200 },
    attackMs: 0,
    sustainMs: 0,
    releaseMs: 0,
    phase: 'sustain',
    level: 0.5,
    bornAtMs: 0,
    releaseAtMs: null,
    releaseFromLevel: 0,
    via: 'sim-via',
    deckGain: 0.8,
    ...over,
  };
}

const serverVoice = (over: Partial<VoiceStat> = {}): VoiceStat => ({
  id: 'srv1',
  busId: 'base',
  effectId: 'aurora',
  mode: 'loop',
  level: 0.6,
  hue: 30,
  releasing: false,
  via: 'server-via',
  ...over,
});

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('store.dockVoices (S17)', () => {
  it('connected: derives from the server-streamed voices, not the local sim voices', () => {
    const store = new TriggerLab(capturing([]));
    // A stale local sim voice (e.g. an ungated section-recall look) must NOT leak into the dock.
    store.voices = [simVoice({ id: 'stale', effectId: 'flash', via: 'sim-via' })];
    store.serverVoices = [serverVoice({ effectId: 'aurora', busId: 'base' })];
    store.link = 'open';

    expect(store.dockVoices).toHaveLength(1);
    expect(store.dockVoices[0]!.effectId).toBe('aurora');
    expect(store.dockVoices[0]!.via).toBe('server-via');
    expect(store.dockVoices.some((v) => v.via === 'sim-via')).toBe(false);
  });

  it('offline: derives from the local sim voices, ignoring any leftover server voices', () => {
    const store = new TriggerLab(capturing([]));
    store.voices = [simVoice({ effectId: 'flash', via: 'sim-via' })];
    store.serverVoices = [serverVoice({ effectId: 'aurora' })];
    store.link = 'offline';

    expect(store.dockVoices).toHaveLength(1);
    expect(store.dockVoices[0]!.effectId).toBe('flash');
    expect(store.dockVoices[0]!.via).toBe('sim-via');
  });
});

describe('bus levels follow the same authority rule (S17)', () => {
  it('connected: snapshot() does not overwrite the server-streamed bus levels', () => {
    const store = new TriggerLab(capturing([]));
    const bus = store.buses[0]!.id;
    store.link = 'open';
    store.busLevels = { [bus]: 0.7 }; // as if just applied from an onStats voice payload

    internals(store).snapshot(); // a normal per-frame tick while connected

    expect(store.busLevels[bus]).toBe(0.7);
  });

  it('offline: snapshot() publishes the local sim bus levels', () => {
    const store = new TriggerLab(capturing([]));
    const bus = store.buses[0]!.id;
    store.link = 'offline';
    store.busLevels = { [bus]: 0.7 };

    internals(store).snapshot(); // offline the sim owns the meters — no voices ⇒ level 0

    expect(store.busLevels[bus]).toBe(0);
  });
});
