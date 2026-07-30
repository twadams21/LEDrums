import { describe, expect, it } from 'vitest';
import { defaultProject } from './defaults';
import { parseProject, projectSchema } from './project-schema';

describe('project schema', () => {
  it('round-trips the default project through serialize -> parse', () => {
    const p = defaultProject();
    const round = parseProject(JSON.parse(JSON.stringify(p)));
    expect(round).toEqual(p);
  });

  it('default project carries a valid top-level transport', () => {
    const p = defaultProject();
    expect(p.transport.bpm).toBeGreaterThan(0);
    expect(p.transport.beatsPerBar).toBeGreaterThan(0);
    expect(p.transport.playing).toBe(true);
  });

  /**
   * DECISION 2's acceptance criterion, asserted rather than assumed: `composition` + `setlist` are
   * gone from the schema and "old files parse clean via zod strip" — no migration machinery, per the
   * greenfield posture. Three things must be true at once, and the third is the honest cost.
   *
   * The three tests this replaces (unknown blend mode, out-of-range opacity, a clip with zero
   * modulations) all validated `composition.layers`. With the field stripped they would have passed
   * VACUOUSLY — parseProject cannot reject a shape it discards — which is worse than not testing it.
   */
  it('strips a pre-Decision-2 file\'s composition + setlist instead of rejecting it', () => {
    const old = {
      ...JSON.parse(JSON.stringify(defaultProject())),
      composition: {
        layers: [{ id: 'base', name: 'Base', role: 'base', blendMode: 'normal', opacity: 1, clips: [], activeClipId: null }],
        transport: { bpm: 155, playing: false, beatsPerBar: 3 },
      },
      setlist: { songs: [{ id: 's1', name: 'Demo', sections: [] }], activeSongId: 's1', activeSectionId: null },
    };

    const parsed = parseProject(old);

    // (1) it PARSES — an old file is readable, not a boot failure.
    expect(parsed.kit.drums.length).toBeGreaterThan(0);
    // (2) both slices are STRIPPED, not carried through as unknown keys.
    expect('composition' in parsed).toBe(false);
    expect('setlist' in parsed).toBe(false);
    // (3) THE COST, stated: the old file's authored tempo lived under `composition`, so it is
    // stripped too and `transport` takes its schema defaults. Two users, no real show files — this
    // is the trade Decision 2 accepted, and it is asserted here rather than discovered later.
    expect(parsed.transport).toEqual({ bpm: 120, playing: true, beatsPerBar: 4 });
  });

  it('a garbage `transport` is still rejected — the relocated field is validated, not waved through', () => {
    const p = JSON.parse(JSON.stringify(defaultProject()));
    p.transport.bpm = -1;
    expect(() => parseProject(p)).toThrow();
    const q = JSON.parse(JSON.stringify(defaultProject()));
    q.transport.beatsPerBar = 2.5;
    expect(() => parseProject(q)).toThrow();
  });
});
