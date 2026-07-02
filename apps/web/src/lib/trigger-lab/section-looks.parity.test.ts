import { describe, expect, it } from 'vitest';
import { voice, type TransportState } from '@ledrums/core';
import { buildShow, type ShowSource } from './show-builder';
import { BUSES, DRUMS, EFFECTS, PRESETS, SECTIONS } from './fixtures';
import { Sim } from './sim';

/* S15 — sim/engine parity. Recalling the SAME section on the offline sim (the reference
   implementation) and on the core engine (the connected authority) must yield the SAME voice
   set, so offline preview and connected output finally agree. The engine hides its voices, so
   — as in the core engine tests — a spawned look is observed by voiceCount + the BUS it lights;
   the sim exposes `voices` directly for the structural side. The engine is fed through the REAL
   show-builder bridge, so this also proves the bridge carries looks end-to-end. */

const transport = (now: number): TransportState => ({
  timeMs: now,
  beat: 0,
  bar: 0,
  beatInBar: 0,
  bpm: 120,
  beatsPerBar: 4,
  playing: true,
});

/** A source mirroring how the store seeds itself, minus graphs/songs — this isolates the
    section-looks recall path. */
function source(): ShowSource {
  return {
    buses: BUSES.map((b) => ({ ...b })),
    graphs: {},
    sections: structuredClone(SECTIONS),
    effects: [...EFFECTS],
    presets: structuredClone(PRESETS),
    drums: DRUMS.map((d) => ({ id: d.id })),
  };
}

/** The buses a set of sim voices occupy (deduped, sorted). */
const busesOf = (vs: readonly { busId: string }[]): string[] => [...new Set(vs.map((v) => v.busId))].sort();

/** The buses the engine currently lights (level > 0), sorted — its observable voice set. */
const litBuses = (stats: voice.EngineStats): string[] =>
  Object.entries(stats.busLevels)
    .filter(([, lvl]) => lvl > 0)
    .map(([id]) => id)
    .sort();

describe('section looks — sim/engine parity', () => {
  it('the same fixture recall produces the same voice set on the sim and the engine', () => {
    const src = source();
    // A fixture section whose looks name ≥2 effects across buses (a non-trivial voice set).
    const section = src.sections.find((s) => Object.values(s.looks).filter((v) => v != null).length >= 2);
    expect(section, 'a fixture section with ≥2 looks').toBeTruthy();

    // Reference: the offline sim.
    const sim = new Sim(src.buses, src.effects, src.presets);
    sim.recallSection(section!);

    // Authority: the core engine, fed the SAME data through the real show-builder bridge.
    const engine = voice.createVoiceBusEngine();
    engine.setShow(buildShow(src));
    engine.applyInput({ kind: 'recallSection', sectionId: section!.id, timeMs: 0 });
    engine.tick(5, 5, transport(5)); // drain recall → spawn looks (born at 5)
    engine.tick(1300, 1295, transport(1300)); // age past the slowest look attack so levels register

    // Same count, same buses occupied → the same voice set at the observable seam.
    expect(sim.voices.length).toBeGreaterThan(1); // non-vacuous
    expect(engine.stats().voiceCount).toBe(sim.voices.length);
    expect(litBuses(engine.stats())).toEqual(busesOf(sim.voices));
  });
});
