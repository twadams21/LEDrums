import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, defaultProject, ReferentialIntegrityError } from '@ledrums/core';
import { buildShow, type ShowSource } from './show-builder';
import { BUSES, DRUMS, PADS, PRESETS, SECTIONS, EFFECTS } from './fixtures';
import { buildLabModel } from './kit';
import { treeToGraph, type TriggerSource } from './sim';
import { makeSection, setSlot, type Song } from '../app/setlist';

/** A ShowSource mirroring how the store seeds itself from the fixtures (graphs are
    keyed by the padKey "drumId:zone" the store + server registry both use). */
function fixtureSource(): ShowSource {
  return {
    buses: BUSES.map((b) => ({ ...b })),
    graphs: Object.fromEntries(PADS.map((p) => [`${p.drumId}:${p.zone}`, treeToGraph(p.tree)])),
    sections: structuredClone(SECTIONS),
    effects: [...EFFECTS],
    presets: structuredClone(PRESETS),
    drums: DRUMS.map((d) => ({ id: d.id })),
  };
}

describe('buildShow', () => {
  it('carries every authored sub-state into the Show aggregate', () => {
    const src = fixtureSource();
    const show = buildShow(src);

    expect(show.buses).toHaveLength(src.buses.length);
    expect(show.sections).toHaveLength(src.sections.length);
    expect(show.effects).toHaveLength(src.effects.length);
    expect(show.presets).toHaveLength(src.presets.length);
    expect(Object.keys(show.graphs)).toEqual(Object.keys(src.graphs));
  });

  it('keys graphs by padKey "drumId:zone"', () => {
    const show = buildShow(fixtureSource());
    // every PADS entry must be reachable under its drumId:zone key
    for (const p of PADS) {
      const key = `${p.drumId}:${p.zone}`;
      expect(show.graphs[key]).toBeDefined();
      expect(show.graphs[key]!.nodes.some((n) => n.kind === 'trigger')).toBe(true);
    }
  });

  it('snapshots arrays (mutating the Show does not alias the source)', () => {
    const src = fixtureSource();
    const show = buildShow(src);
    show.buses.push({ id: 'extra', name: 'Extra', polyphony: 'poly', crossfadeMs: 0 });
    expect(src.buses).toHaveLength(BUSES.length); // source untouched
  });
});

// Trigger-source structural identity (U1): a graph whose trigger node carries a `source`
// must round-trip through buildShow unchanged. Because buildShow returns a voice.Show,
// reading `.source` off the result ALSO proves the core mirror field exists and matches
// shape — a web↔core divergence would fail typecheck here, not just at runtime.
describe('buildShow carries the trigger source (web↔core structural identity)', () => {
  it('round-trips each source variant through to the voice.Show', () => {
    const src = fixtureSource();
    const k0 = `${PADS[0]!.drumId}:${PADS[0]!.zone}`;
    const k1 = `${PADS[1]!.drumId}:${PADS[1]!.zone}`;
    const k2 = `${PADS[2]!.drumId}:${PADS[2]!.zone}`;
    const setSource = (key: string, source: TriggerSource): void => {
      const trig = src.graphs[key]!.nodes.find((n) => n.kind === 'trigger')!;
      trig.source = source;
    };
    setSource(k0, { kind: 'drum', drumId: PADS[0]!.drumId, zone: String(PADS[0]!.zone) });
    setSource(k1, { kind: 'midi', note: 38 });
    setSource(k2, { kind: 'osc', address: '/snare' });

    const show = buildShow(src);
    const sourceOf = (key: string) => show.graphs[key]!.nodes.find((n) => n.kind === 'trigger')!.source;
    expect(sourceOf(k0)).toEqual({ kind: 'drum', drumId: PADS[0]!.drumId, zone: String(PADS[0]!.zone) });
    expect(sourceOf(k1)).toEqual({ kind: 'midi', note: 38 });
    expect(sourceOf(k2)).toEqual({ kind: 'osc', address: '/snare' });
  });
});

// Integrity boundary (#3): buildShow runs the core referential-integrity check, so a
// dangling reference throws at build time instead of silently going dark downstream.
describe('buildShow referential integrity', () => {
  it('throws when a graph references a drum not in the kit', () => {
    const src = fixtureSource();
    src.graphs = { ...src.graphs, 'tom:0': treeToGraph(PADS[0]!.tree) }; // kit has tom1, not tom
    expect(() => buildShow(src)).toThrow(ReferentialIntegrityError);
    expect(() => buildShow(src)).toThrow(/graph "tom:0" → drum "tom"/);
  });

  it('throws when a setlist slot references a graph that does not exist', () => {
    const src = fixtureSource();
    const padKeys = PADS.map((p) => `${p.drumId}:${p.zone}`);
    let song: Song = { id: 's1', name: 'S1', sections: [makeSection('a', 'A', padKeys)] };
    song = setSlot(song, 'a', 'kick:0', 0, 'kick:9'); // no graph keyed kick:9
    src.songs = [song];
    expect(() => buildShow(src)).toThrow(/setlist slot → graph "kick:9"/);
  });

  it('passes when setlist slots reference real graphs', () => {
    const src = fixtureSource();
    const padKeys = PADS.map((p) => `${p.drumId}:${p.zone}`);
    const realKey = `${PADS[0]!.drumId}:${PADS[0]!.zone}`;
    let song: Song = { id: 's1', name: 'S1', sections: [makeSection('a', 'A', padKeys)] };
    song = setSlot(song, 'a', realKey, 0, realKey); // the pad's own graph (the seed case)
    src.songs = [song];
    expect(() => buildShow(src)).not.toThrow();
  });
});

// Regression + drift guard: drum-scoped voices only render when the authored content's
// drum ids exist in the kit the compositor runs against (`drumById.get(sourceDrumId)`).
// The offline lab model and the engine kit both derive from the ONE canonical
// DEFAULT_KIT now, so they cannot diverge again (the prior 'tom' vs 'tom1' bug).
describe('fixture drum ids resolve against the kit', () => {
  it('the offline lab model is built from the canonical kit (no divergent copy)', () => {
    const labDrumIds = buildLabModel().model.drums.map((d) => d.id);
    expect(labDrumIds).toEqual(DEFAULT_KIT.drums.map((d) => d.id));
  });

  it('every fixture drum exists in the local lab kit (offline preview path)', () => {
    const labDrumIds = new Set(buildLabModel().model.drums.map((d) => d.id));
    for (const d of DRUMS) expect(labDrumIds.has(d.id)).toBe(true);
  });

  it('every fixture drum exists in the canonical engine kit (connected path)', () => {
    const kitDrumIds = new Set(defaultProject().kit.drums.map((d) => d.id));
    for (const d of DRUMS) expect(kitDrumIds.has(d.id)).toBe(true);
  });
});
