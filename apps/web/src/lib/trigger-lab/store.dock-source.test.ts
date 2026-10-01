import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';
import type { VoiceStat } from '../ws/protocol-types';

/* S17 — the Layers dock reads server-truth when connected. `store.dockVoices` source-selects
   between the streamed server voices (link open) and the Sim engine's voices (offline); and while
   connected the per-frame `snapshot()` must NOT clobber the server-streamed bus levels. */

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

const serverVoice = (over: Partial<VoiceStat> = {}): VoiceStat => ({
  id: 'srv1',
  busId: 'base',
  effectId: 'aurora',
  mode: 'loop',
  level: 0.6,
  hue: 30,
  releasing: false,
  via: 'server-via',
  pad: '',
  ...over,
});

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('store.dockVoices (S17)', () => {
  it('connected: derives from the server-streamed voices, not the Sim voices', () => {
    const store = new TriggerLab(capturing([]));
    // A stale offline Sim voice must NOT leak into the dock.
    store.effectVoices = [serverVoice({ id: 'stale', effectId: 'flash', via: 'sim-via' })];
    store.serverVoices = [serverVoice({ effectId: 'aurora', busId: 'base' })];
    store.link = 'open';

    expect(store.dockVoices).toHaveLength(1);
    expect(store.dockVoices[0]!.effectId).toBe('aurora');
    expect(store.dockVoices[0]!.via).toBe('server-via');
    expect(store.dockVoices.some((v) => v.via === 'sim-via')).toBe(false);
  });

  it('offline: derives from the Sim’s engine voices, ignoring leftover server voices', () => {
    const store = new TriggerLab(capturing([]));
    store.serverVoices = [serverVoice({ effectId: 'aurora' })];
    store.effectVoices = [serverVoice({ effectId: 'chain:solid', via: 'effect-via' })];
    store.link = 'offline';

    expect(store.dockVoices).toHaveLength(1);
    expect(store.dockVoices[0]!.effectId).toBe('chain:solid');
    expect(store.dockVoices[0]!.via).toBe('effect-via');
  });

  it('offline: a fired Effect reaches the dock through the Sim’s engine stats', () => {
    const store = new TriggerLab(capturing([]));
    store.link = 'offline';
    const effect = store.activeSection!.effects![0]!;
    store.fireEffect(effect.id);
    store.sim.tick(16);
    (store as unknown as { lastVoiceStatsAt: number }).lastVoiceStatsAt = -Infinity; // telemetry window due
    internals(store).snapshot();
    expect(store.dockVoices.length).toBeGreaterThan(0);
  });
});

describe('bus levels follow the same authority rule (S17)', () => {
  const statsDue = (store: TriggerLab): void => {
    (store as unknown as { lastVoiceStatsAt: number }).lastVoiceStatsAt = -Infinity;
  };

  it('connected: snapshot() does not overwrite the server-streamed bus levels', () => {
    const store = new TriggerLab(capturing([]));
    store.link = 'open';
    store.busLevels = { bus: 0.7 }; // as if just applied from an onStats voice payload
    statsDue(store);

    internals(store).snapshot(); // a normal per-frame tick while connected

    expect(store.busLevels).toEqual({ bus: 0.7 });
  });

  it('offline: snapshot() publishes the Sim engine’s bus levels', () => {
    const store = new TriggerLab(capturing([]));
    store.link = 'offline';
    store.busLevels = { bus: 0.7 };
    statsDue(store);
    internals(store).snapshot(); // no voices ⇒ no bus carries a level
    expect(store.busLevels).toEqual({});

    store.fireEffect(store.activeSection!.effects[0]!.id);
    for (let i = 0; i < 10; i++) store.sim.tick(16); // past the attack
    statsDue(store);
    internals(store).snapshot();
    const levels = Object.values(store.busLevels);
    expect(levels.length).toBe(1);
    expect(levels[0]).toBeGreaterThan(0);
  });
});
