import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, defaultProject, ReferentialIntegrityError } from '@ledrums/core';
import { buildShow, type ShowSource } from './show-builder';
import { BUSES, DRUMS, PADS, PRESETS, SECTIONS, EFFECTS } from './fixtures';
import { buildLabModel } from './kit';
import { treeToGraph, type TriggerSource } from './sim';
import { makeSection, type Song } from '../app/setlist';

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

  it('throws when a section references a graph that does not exist', () => {
    const src = fixtureSource();
    const song: Song = { id: 's1', name: 'S1', sections: [makeSection('a', 'A', ['kick:9'])] }; // no graph keyed kick:9
    src.songs = [song];
    expect(() => buildShow(src)).toThrow(/setlist slot → graph "kick:9"/);
  });

  it('passes when a section references real graphs', () => {
    const src = fixtureSource();
    const realKey = `${PADS[0]!.drumId}:${PADS[0]!.zone}`;
    const song: Song = { id: 's1', name: 'S1', sections: [makeSection('a', 'A', [realKey])] }; // the pad's own graph
    src.songs = [song];
    expect(() => buildShow(src)).not.toThrow();
  });
});

// U4 bridge: the web section is a FLAT graph list, but the engine resolves a hit by a
// padKey-keyed slot grid — buildShow reconstructs that grid from each graph's `drum` source.
describe('buildShow bridges a section’s flat graphs → the engine slot grid', () => {
  it('groups graphs under their drum-source padKey (order preserved); omits midi/osc', () => {
    const src = fixtureSource();
    const drumKey = `${PADS[0]!.drumId}:${PADS[0]!.zone}`; // a pad graph bound to its drum
    const midiKey = `${PADS[1]!.drumId}:${PADS[1]!.zone}`; // re-bind this one to a raw MIDI input
    const setSource = (key: string, source: TriggerSource): void => {
      src.graphs[key]!.nodes.find((n) => n.kind === 'trigger')!.source = source;
    };
    setSource(drumKey, { kind: 'drum', drumId: PADS[0]!.drumId, zone: String(PADS[0]!.zone) });
    setSource(midiKey, { kind: 'midi', note: 38 }); // direct MIDI binding — not pad-bound

    const song: Song = { id: 's1', name: 'S1', sections: [makeSection('a', 'A', [drumKey, midiKey])] };
    src.songs = [song];

    const slots = buildShow(src).songs![0]!.sections[0]!.slots;
    expect(slots[drumKey]).toEqual([drumKey]); // drum-source graph → its padKey slot
    expect(Object.keys(slots)).toEqual([drumKey]); // MIDI-source graph omitted (fires via direct routing)
  });
});

// S15 bridge: a section's per-bus `looks` (the loop effects the engine spawns on recall)
// must arrive on the voice.Show intact — the connected engine reads exactly this map. And
// as a DEEP copy, so the sent snapshot never aliases the rune-backed section state.
describe('buildShow bridges a section’s per-bus looks (S15)', () => {
  it('carries each section’s looks map onto the Show verbatim', () => {
    const show = buildShow(fixtureSource());
    for (const src of SECTIONS) {
      const bridged = show.sections.find((s) => s.id === src.id);
      expect(bridged?.looks).toEqual(src.looks);
    }
  });

  it('deep-copies looks (a fresh object, not an alias of the source section)', () => {
    const src = fixtureSource();
    const show = buildShow(src);
    expect(show.sections[0]!.looks).not.toBe(src.sections[0]!.looks); // distinct reference
    show.sections[0]!.looks.base = 'mutated';
    expect(src.sections[0]!.looks.base).not.toBe('mutated'); // source untouched
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
