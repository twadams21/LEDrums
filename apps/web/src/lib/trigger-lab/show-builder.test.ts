import { describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { buildShow, type ShowSource } from './show-builder';
import { BUSES, DRUMS, PADS, PRESETS, SECTIONS, EFFECTS } from './fixtures';
import { buildLabModel } from './kit';
import { treeToGraph } from './sim';

/** A ShowSource mirroring how the store seeds itself from the fixtures (graphs are
    keyed by the padKey "drumId:zone" the store + server registry both use). */
function fixtureSource(): ShowSource {
  return {
    buses: BUSES.map((b) => ({ ...b })),
    graphs: Object.fromEntries(PADS.map((p) => [`${p.drumId}:${p.zone}`, treeToGraph(p.tree)])),
    sections: structuredClone(SECTIONS),
    effects: [...EFFECTS],
    presets: structuredClone(PRESETS),
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

// Regression: drum-scoped voices only render when the authored content's drum ids
// exist in the kit the compositor runs against (`drumById.get(sourceDrumId)`). If a
// fixture drum id is absent from the kit, every drum-scoped effect on it goes dark
// (the "effects don't trigger reliably" bug — fixtures used 'tom', the kit 'tom1').
describe('fixture drum ids resolve against the kit', () => {
  it('every fixture drum exists in the local lab kit (offline preview path)', () => {
    const labDrumIds = new Set(buildLabModel().model.drums.map((d) => d.id));
    for (const d of DRUMS) expect(labDrumIds.has(d.id)).toBe(true);
  });

  it('every fixture drum exists in the canonical engine kit (connected path)', () => {
    const kitDrumIds = new Set(defaultProject().kit.drums.map((d) => d.id));
    for (const d of DRUMS) expect(kitDrumIds.has(d.id)).toBe(true);
  });
});
