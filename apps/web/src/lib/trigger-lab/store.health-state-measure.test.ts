// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { performance } from 'node:perf_hooks';
import { TriggerLab } from './store.svelte';
import { ShowsController } from './shows-controller.svelte';
import { SHOWS_V3_STORAGE_KEY, serializeShowLibraryV3, type ShowLibraryV3 } from './persistence';
import { seedDocumentV3 } from './store/seed';
import type { WSClient } from '../ws/client';

// Synthetic, repeatable CPU/retention probe; not a browser frame-rate or hardware claim.
// Kept opt-in so ordinary targeted correctness runs do not repeatedly pay the measurement cost.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.skipIf(!process.env.HEALTH_STATE_MEASURE)('measures large-library drag/materialization and retained history', () => {
  const seed = seedDocumentV3();
  const section = seed.songs[0]!.sections[0]!;
  const template = section.effects[0]!;
  // 40 Effects in the active section, the drag target first.
  section.effects = Array.from({ length: 40 }, (_, i) => ({ ...structuredClone(template), id: `fx-${i}` }));
  const library: ShowLibraryV3 = {
    activeShowId: 'show-0',
    shows: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`show-${i}`, { id: `show-${i}`, name: `Show ${i}`, authored: structuredClone(seed) }])),
  };
  const blob = JSON.stringify(serializeShowLibraryV3(library));
  const storage = new Map([[SHOWS_V3_STORAGE_KEY, blob]]);
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.useFakeTimers();
  const store = new TriggerLab(() => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient);
  store.start();
  flushSync();
  vi.advanceTimersByTime(500);
  const snapshots = vi.spyOn(ShowsController.prototype, 'currentLibrary');
  const samples: number[] = [];
  store.beginGesture();
  for (let i = 1; i <= 60; i++) {
    const start = performance.now();
    store.setEffectOpacity('fx-0', i / 60);
    flushSync();
    samples.push(performance.now() - start);
  }
  store.endGesture();
  const duringDrag = snapshots.mock.calls.length;
  const flushStart = performance.now();
  vi.advanceTimersByTime(500);
  const flushMs = performance.now() - flushStart;
  const afterFlush = snapshots.mock.calls.length;
  for (let i = 0; i < 100; i++) store.runUndoable(() => { store.bpm = 100 + i; });
  // Instrument retained checkpoint payload, not process heap (which includes Svelte/Vitest/GC).
  const internals = store as unknown as { undoStack?: unknown[]; history?: { entries: unknown[]; stats: { entries: number; bytes: number } } };
  const history = internals.history?.stats ?? { entries: internals.undoStack!.length, bytes: JSON.stringify(internals.undoStack).length * 2 };
  // Same conservative estimator as history, but start ownership afresh for each checkpoint:
  // the counterfactual cost of retaining these exact snapshots WITHOUT across-entry sharing.
  function estimate(value: unknown, seen = new Set<object>()): number {
    if (!value || typeof value !== 'object' || seen.has(value)) return 0;
    seen.add(value);
    let bytes = (Array.isArray(value) ? 24 + value.length * 8 : 32) + 48;
    for (const [key, child] of Object.entries(value)) {
      bytes += 16 + key.length * 2 + (typeof child === 'string' ? child.length * 2 : 8);
      bytes += estimate(child, seen);
    }
    return bytes;
  }
  const unsharedEstimatedBytes = (internals.history?.entries ?? internals.undoStack!).reduce<number>((sum, entry) => sum + estimate(entry), 0);
  samples.sort((a, b) => a - b);
  console.log('HEALTH_STATE_MEASURE', JSON.stringify({ libraryUtf8Bytes: new TextEncoder().encode(blob).byteLength, shows: 24, effectsPerSection: 40, moves: 60, materializationsDuringDrag: duringDrag, materializationsAfterFlush: afterFlush, dragP50Ms: samples[30], dragP95Ms: samples[57], dragTotalMs: samples.reduce((a, b) => a + b, 0), flushMs, history, unsharedEstimatedBytes }));
  expect(JSON.parse(storage.get(SHOWS_V3_STORAGE_KEY)!).data.shows['show-0'].authored.songs[0].sections[0].effects[0].opacity).toBe(1);
  store.stop();
});
