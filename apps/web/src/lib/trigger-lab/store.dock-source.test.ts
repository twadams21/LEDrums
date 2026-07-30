import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';
import type { EngineStats } from '@ledrums/core';
import type { ClientMessage, OutputStatus, VoiceStat } from '../ws/protocol-types';

/* S17 — the docks read ENGINE truth, and only engine truth. `store.dockVoices` and the bus meters
   come from the streamed stats while the link is open; INIT-01 Decision 3 retired the browser-side
   sim that used to be the offline second source, so with the link down there is nothing to show.
   The drop path must CLEAR what it was showing: a frozen last-known reading is indistinguishable
   from a live one, which is exactly the class of lie this initiative removes. */

import { MemStorage } from '../test-support/mem-storage';
import { newHarness, harnessClient, type Harness } from '../test-support/ws-harness';

const capturing = (sent: ClientMessage[]): (() => WSClient) =>
  () =>
    ({ on() {}, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient;

/** rAF is unavailable in node; stub it so `start()` can wire the client without a live loop. */
function withRaf(fn: () => void): void {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  try {
    fn();
  } finally {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
  }
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

const engineStats = (over: Partial<EngineStats> = {}): EngineStats => ({
  timeMs: 4000,
  beat: 8,
  bar: 3,
  activeTriggers: 1,
  tickCount: 120,
  pixelCount: 548,
  ...over,
});

const OUTPUT: OutputStatus = { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 10, lastError: null, universeCount: 0 };

/** Drive one `stats` tick through the harness — the real path the docks are fed from. */
function fireStats(h: Harness, opts: { stats?: Partial<EngineStats>; voices?: VoiceStat[]; busLevels?: Record<string, number>; fps?: number } = {}): void {
  h.cb!.onStats!(engineStats(opts.stats), 12, opts.fps ?? 44, OUTPUT, {
    voiceCount: opts.voices?.length ?? 0,
    busLevels: opts.busLevels ?? {},
    voices: opts.voices ?? [],
  });
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('store.dockVoices (S17)', () => {
  it('connected: derives from the engine-streamed voices', () => {
    const store = new TriggerLab(capturing([]));
    store.serverVoices = [serverVoice({ effectId: 'aurora', busId: 'base' })];
    store.link = 'open';

    expect(store.dockVoices).toHaveLength(1);
    expect(store.dockVoices[0]!.effectId).toBe('aurora');
    expect(store.dockVoices[0]!.via).toBe('server-via');
  });

  it('offline: shows nothing — no renderer, so nothing is sounding', () => {
    const store = new TriggerLab(capturing([]));
    // Even with a leftover engine list still in the field, the gate holds: the dock is empty.
    store.serverVoices = [serverVoice({ effectId: 'aurora' })];
    store.link = 'offline';

    expect(store.dockVoices).toEqual([]);
  });
});

describe('engine stats are the only writer of the transient dock/transport truth', () => {
  it('a stats tick adopts the voices, bus levels, transport clock and output rate', () => {
    const h = newHarness();
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();
      h.cb!.onConnection!('open');
      const bus = store.buses[0]!.id;

      fireStats(h, { voices: [serverVoice()], busLevels: { [bus]: 0.7 }, stats: { beat: 8, timeMs: 4000 }, fps: 44 });

      expect(store.dockVoices).toHaveLength(1);
      expect(store.busLevels[bus]).toBe(0.7);
      // The transport readout is the ENGINE's clock — the browser advances no clock of its own.
      expect(store.beat).toBe(8);
      expect(store.timeMs).toBe(4000);
      expect(store.fps).toBe(44);
      expect(store.engineTransportLive).toBe(true);
    });
  });

  it('a link drop clears them instead of freezing the last reading', () => {
    const h = newHarness();
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();
      h.cb!.onConnection!('open');
      const bus = store.buses[0]!.id;
      fireStats(h, { voices: [serverVoice()], busLevels: { [bus]: 0.7 }, stats: { beat: 8, timeMs: 4000 }, fps: 44 });

      h.cb!.onConnection!('closed');

      expect(store.link).toBe('offline');
      expect(store.dockVoices).toEqual([]);
      expect(store.busLevels).toEqual({});
      expect(store.beat).toBe(0);
      expect(store.timeMs).toBe(0);
      expect(store.fps).toBe(0);
      expect(store.engineTransportLive).toBe(false);
      // …and the visualiser stops claiming live output rather than holding the last frame.
      expect(store.enginePreviewLive).toBe(false);
    });
  });
});
