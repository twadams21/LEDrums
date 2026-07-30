import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { voice, type TransportState } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { buildShow } from './show-builder';
import type { WSClient } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';

/* S16 — authored section looks. A look picked in the Section inspector edits the AUTHORED
   `SetlistSection.looks` (via `store.arrangement.setLook`), which must (a) persist + drive the offline sim
   preview immediately, and (b) flow through the real `buildShow` bridge onto `Show.sections`
   so the connected core engine spawns it on recall. This is the end-to-end acceptance: pick a
   look → recall → it plays on both the offline sim and the engine (== the visualiser). */

import { MemStorage } from '../test-support/mem-storage';

const capturing = (sent: ClientMessage[]): (() => WSClient) =>
  () =>
    ({ on() {}, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient;

const transport = (now: number): TransportState => ({
  timeMs: now,
  beat: 0,
  bar: 0,
  beatInBar: 0,
  bpm: 120,
  beatsPerBar: 4,
  playing: true,
});

/** The buses the engine currently lights (level > 0) — its observable voice set. */
const litBuses = (stats: voice.EngineStats): string[] =>
  Object.entries(stats.busLevels)
    .filter(([, lvl]) => lvl > 0)
    .map(([id]) => id)
    .sort();

/** Recall `sectionId` on a fresh engine fed the store's authored Show, then age it so the
    look's attack registers as a bus level — the engine hides voices, so a lit bus is the
    observable "the look spawned" signal (as in the core engine + parity tests). */
const litBusesAfterRecall = (store: TriggerLab, sectionId: string): string[] => {
  const engine = voice.createVoiceBusEngine();
  engine.setShow(buildShow(store.showSource));
  engine.applyInput({ kind: 'recallSection', sectionId, timeMs: 0 });
  engine.tick(5, 5, transport(5)); // drain recall → spawn looks (born at 5)
  engine.tick(1300, 1295, transport(1300)); // age past the slowest look attack
  return litBuses(engine.stats());
};

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('setLook — authored per-bus section looks (S16)', () => {
  it('writes the look into the AUTHORED model (songs), not a fixture side-array', () => {
    const store = new TriggerLab(capturing([]));
    const sectionId = store.library.activeSong!.sections[0]!.id;

    store.arrangement.setLook(sectionId, 'base', 'gen:perlin-clouds');

    expect(store.library.activeSong!.sections[0]!.looks.base).toBe('gen:perlin-clouds'); // authored SetlistSection
    expect(store.arrangement.sections.find((s) => s.id === sectionId)!.looks.base).toBe('gen:perlin-clouds'); // derived look-list agrees
  });

  it('offline: picking a look on the ACTIVE section authors it and sends nothing', () => {
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(capturing(sent));
    const sectionId = store.library.activeSong!.sections[0]!.id;
    store.setActiveSection(sectionId); // make it active (no engine to recall on)

    store.arrangement.setLook(sectionId, 'base', 'gen:perlin-clouds');

    // The edit is authored + persisted; nothing morphs, because the engine is the only renderer
    // (INIT-01 Decision 3). It takes visible effect on the next connect, via the Show resync.
    expect(store.library.activeSong!.sections.find((s) => s.id === sectionId)!.looks.base).toBe('gen:perlin-clouds');
    expect(sent).toHaveLength(0);
  });

  it('connected: an authored look flows through buildShow onto the engine (spawns on recall)', () => {
    const store = new TriggerLab(capturing([]));
    // A BRAND-NEW authored section (id minted at runtime, not a fixture) with a single base look —
    // proves the engine spawns AUTHORED looks, not just the fixture-seeded ones.
    store.arrangement.addSongSection('My Section');
    const sectionId = store.arrangement.activeSectionId!;
    expect(store.library.activeSong!.sections.find((s) => s.id === sectionId)!.looks).toEqual({}); // starts silent

    store.arrangement.setLook(sectionId, 'base', 'gen:perlin-clouds');

    expect(litBusesAfterRecall(store, sectionId)).toContain('base'); // authored → bridge → engine
  });

  it('None (null) releases the bus — recalling a cleared look lights nothing', () => {
    const store = new TriggerLab(capturing([]));
    store.arrangement.addSongSection('My Section');
    const sectionId = store.arrangement.activeSectionId!;
    store.arrangement.setLook(sectionId, 'base', 'gen:perlin-clouds');
    expect(litBusesAfterRecall(store, sectionId)).toContain('base');

    store.arrangement.setLook(sectionId, 'base', null); // pick "None"

    expect(litBusesAfterRecall(store, sectionId)).toEqual([]); // silent again
  });
});
