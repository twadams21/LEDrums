import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent, type RenderEngine } from './engine';
import type { VoiceDiagnostic } from './diagnostics';
import { emptyShow, type Show, type ShowSong } from './types';

/* Global control bindings, engine half: a `globalControl` input resolves a RELATIVE
   setlist move against the engine's own active song/section, at queue-drain time.

   The observable is the `section-recalled` diagnostic, which is the same one an absolute
   `recallSection` emits — by design: a navigation and a direct recall must be
   indistinguishable downstream. */

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

function transport(now: number): TransportState {
  return { timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
}

function song(id: string, sectionIds: string[]): ShowSong {
  return { id, name: id, sections: sectionIds.map((sid) => ({ id: sid, name: sid, slots: {} })) };
}

function showFixture(): Show {
  return { ...emptyShow(), songs: [song('A', ['a1', 'a2', 'a3']), song('B', ['b1', 'b2'])] };
}

const nav = (action: InputEvent['action'], timeMs: number): InputEvent => ({ kind: 'globalControl', action, timeMs });

/** An engine seeded with the fixture show, plus the recall diagnostics it emits. */
function setup(): { engine: RenderEngine; recalls: Array<{ songId: string | null; sectionId: string | null }> } {
  const recalls: Array<{ songId: string | null; sectionId: string | null }> = [];
  const engine = createVoiceBusEngine({
    onDiagnostic: (d: VoiceDiagnostic) => {
      if (d.kind === 'section-recalled') recalls.push({ songId: d.songId, sectionId: d.sectionId });
    },
  });
  engine.setModel(testModel());
  engine.setShow(showFixture()); // seeds active = A / a1, emits no diagnostic
  return { engine, recalls };
}

describe('globalControl input — navigation', () => {
  it('advances a section', () => {
    const { engine, recalls } = setup();
    engine.applyInput(nav('nextSection', 0));
    engine.tick(10, 10, transport(10));
    expect(recalls).toEqual([{ songId: 'A', sectionId: 'a2' }]);
  });

  it('goes back a section', () => {
    const { engine, recalls } = setup();
    engine.applyInput(nav('nextSection', 0));
    engine.applyInput(nav('prevSection', 1));
    engine.tick(10, 10, transport(10));
    expect(recalls.at(-1)).toEqual({ songId: 'A', sectionId: 'a1' });
  });

  it('advances a song and lands on its first section', () => {
    const { engine, recalls } = setup();
    engine.applyInput(nav('nextSong', 0));
    engine.tick(10, 10, transport(10));
    expect(recalls).toEqual([{ songId: 'B', sectionId: 'b1' }]);
  });

  it('goes back a song', () => {
    const { engine, recalls } = setup();
    engine.applyInput(nav('nextSong', 0));
    engine.applyInput(nav('prevSong', 1));
    engine.tick(10, 10, transport(10));
    expect(recalls.at(-1)).toEqual({ songId: 'A', sectionId: 'a1' });
  });

  it('N taps inside ONE tick advance N steps', () => {
    // The reason this resolves in the engine rather than on the server: the input queue
    // drains per tick, so a server-side resolver would compute every tap in this burst
    // against the SAME stale active section and land on a2 three times over.
    const { engine, recalls } = setup();
    engine.applyInput(nav('nextSection', 0));
    engine.applyInput(nav('nextSection', 0));
    engine.tick(10, 10, transport(10));
    expect(recalls).toEqual([
      { songId: 'A', sectionId: 'a2' },
      { songId: 'A', sectionId: 'a3' },
    ]);
  });

  it('CLAMPS at the last section — a stray extra tap emits nothing at all', () => {
    const { engine, recalls } = setup();
    for (let i = 0; i < 5; i++) engine.applyInput(nav('nextSection', i));
    engine.tick(10, 10, transport(10));
    // a1 → a2 → a3, then two taps that go nowhere. No re-recall of a3 (that would
    // restart its base looks — a visible glitch for a button that did nothing).
    expect(recalls).toEqual([
      { songId: 'A', sectionId: 'a2' },
      { songId: 'A', sectionId: 'a3' },
    ]);
  });

  it('CLAMPS at the first song', () => {
    const { engine, recalls } = setup();
    engine.applyInput(nav('prevSong', 0));
    engine.tick(10, 10, transport(10));
    expect(recalls).toEqual([]);
  });

  it('section navigation never crosses into the next song', () => {
    const { engine, recalls } = setup();
    for (let i = 0; i < 6; i++) engine.applyInput(nav('nextSection', i));
    engine.tick(10, 10, transport(10));
    expect(recalls.every((r) => r.songId === 'A')).toBe(true);
  });

  it('an absolute recall then a relative move compose (nav reads the recalled position)', () => {
    const { engine, recalls } = setup();
    engine.applyInput({ kind: 'recallSection', songId: 'B', sectionId: 'b1', timeMs: 0 });
    engine.applyInput(nav('nextSection', 1));
    engine.tick(10, 10, transport(10));
    expect(recalls).toEqual([
      { songId: 'B', sectionId: 'b1' },
      { songId: 'B', sectionId: 'b2' },
    ]);
  });

  it('ignores an event with no action', () => {
    const { engine, recalls } = setup();
    engine.applyInput({ kind: 'globalControl', timeMs: 0 });
    engine.tick(10, 10, transport(10));
    expect(recalls).toEqual([]);
  });

  it('is a no-op on a show with no songs', () => {
    const recalls: Array<unknown> = [];
    const engine = createVoiceBusEngine({
      onDiagnostic: (d) => {
        if (d.kind === 'section-recalled') recalls.push(d);
      },
    });
    engine.setModel(testModel());
    engine.setShow(emptyShow());
    engine.applyInput(nav('nextSong', 0));
    engine.tick(10, 10, transport(10));
    expect(recalls).toEqual([]);
  });

  it('is deterministic — the same event log replays to the same recalls', () => {
    const runs = [setup(), setup()].map(({ engine, recalls }) => {
      engine.applyInput(nav('nextSection', 0));
      engine.applyInput(nav('nextSong', 1));
      engine.applyInput(nav('nextSection', 2));
      engine.tick(10, 10, transport(10));
      return recalls;
    });
    expect(runs[0]).toEqual(runs[1]);
  });
});
