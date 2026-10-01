/* Cell play at the engine seam (Tim, 2026-10-01: the graph's Sequence + Random nodes re-homed on
   the cell): a Sequence cell plays ONE Effect per hit in stack order, a Random cell one at random
   without an immediate repeat, a reset input rewinds it, and a section start does too. Three solid
   Effects on one Kick cell — red, green, blue — so the light on the drum says which step played. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { parseEffect, type CellPlay, type Effect, type EffectCell } from '../effect-chain/types';
import { createVoiceBusEngine, type InputEvent } from './engine';
import type { VoiceDiagnostic } from './diagnostics';
import { emptyShow, type Show, type SongSection } from './types';

const KICK: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };

function model(): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: ['kick', 'snare'].map((id, i) => ({ id, diameterIn: 12, hoopSpacingMm: 50, origin: { x: i * 400, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } })),
  }));
}
const transport = (beat = 0): TransportState => ({ timeMs: 0, beat, bar: 0, beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true });

/** A short solid flash on the kick, so each hit's light is gone before the next. */
const flash = (id: string, color: string): Effect =>
  parseEffect({ id, cell: KICK, generator: { kind: 'solid', style: 'solid', params: { color } }, amp: { attackMs: 0, length: { ms: 30 }, releaseMs: 0 } });
const STACK = [flash('r', '#ff0000'), flash('g', '#00ff00'), flash('b', '#0000ff')];

function harness(cellPlay: CellPlay[], extraSection?: SongSection, stack: Effect[] = STACK) {
  const diags: VoiceDiagnostic[] = [];
  const engine = createVoiceBusEngine({ onDiagnostic: (d) => diags.push(d) });
  const m = model();
  engine.setModel(m);
  const sections: SongSection[] = [{ id: 's', name: 's', effects: stack, cellPlay }, ...(extraSection ? [extraSection] : [])];
  const show: Show = { ...emptyShow(), songs: [{ id: 'song', name: 'Song', sections }] };
  engine.setShow(show);
  let now = 0;
  const step = (ms: number) => {
    const end = now + ms;
    while (now < end) { engine.tick(now, 10, transport()); now += 10; }
    engine.tick(now, 10, transport());
  };
  step(10);
  const send = (ev: Omit<InputEvent, 'timeMs'>) => { engine.applyInput({ ...ev, timeMs: now } as InputEvent); step(20); };
  /** Which colours light the kick right now. */
  const lit = (): string => {
    const d = m.drumById.get('kick')!;
    const f = engine.frame();
    const sum = [0, 1, 2].map((c) => { let s = 0; for (let i = d.pixelStart; i < d.pixelStart + d.pixelCount; i++) s += f[i * 4 + c]!; return s; });
    return ['r', 'g', 'b'].filter((_, c) => sum[c]! > 0).join('');
  };
  /** Hit the kick, read which colour lit it, then let it fade. */
  const hit = (): string => {
    send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1 });
    const now = lit();
    step(100);
    return now;
  };
  /** Hit the kick and read what is lit, WITHOUT waiting for it to fade. */
  const strike = (): string => {
    send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1 });
    return lit();
  };
  return { hit, strike, send, diags };
}

describe('Sequence cell', () => {
  it('plays one Effect per hit, in stack order, wrapping round', () => {
    const h = harness([{ cell: KICK, mode: 'sequence' }]);
    expect([h.hit(), h.hit(), h.hit(), h.hit()]).toEqual(['r', 'g', 'b', 'r']);
  });

  it('a Layer cell (no entry) still plays the whole stack on every hit', () => {
    const h = harness([]);
    expect(h.hit()).toBe('rgb');
  });

  it('a MIDI-note reset rewinds it — and a reset-only note is not reported as a miss', () => {
    const h = harness([{ cell: KICK, mode: 'sequence', reset: { kind: 'midiNote', note: 30 } }]);
    expect([h.hit(), h.hit()]).toEqual(['r', 'g']);
    h.send({ kind: 'noteOn', note: 30, velocity: 1 });
    expect(h.diags.map((d) => d.kind)).not.toContain('input-unrouted');
    expect(h.diags.map((d) => d.kind)).not.toContain('effect-missed');
    expect(h.hit()).toBe('r');
  });

  it('a drum-zone reset rewinds it', () => {
    const h = harness([{ cell: KICK, mode: 'sequence', reset: { kind: 'zone', drumId: 'snare', slot: 0 } }]);
    expect([h.hit(), h.hit()]).toEqual(['r', 'g']);
    h.send({ kind: 'noteOn', drumId: 'snare', zone: '0', velocity: 1 });
    expect(h.hit()).toBe('r');
  });

  it('starting the section again rewinds every cell', () => {
    const h = harness([{ cell: KICK, mode: 'sequence' }], { id: 't', name: 't', effects: [] });
    expect([h.hit(), h.hit()]).toEqual(['r', 'g']);
    h.send({ kind: 'recallSection', songId: 'song', sectionId: 't' });
    h.send({ kind: 'recallSection', songId: 'song', sectionId: 's' });
    expect(h.hit()).toBe('r');
  });
});

describe('Random cell', () => {
  it('plays one Effect per hit, never the same one twice running, and replays identically', () => {
    const run = () => { const h = harness([{ cell: KICK, mode: 'random' }]); return Array.from({ length: 12 }, () => h.hit()); };
    const a = run();
    expect(a.every((x) => x.length === 1)).toBe(true);
    for (let i = 1; i < a.length; i++) expect(a[i], `hit ${i}`).not.toBe(a[i - 1]);
    expect(new Set(a).size).toBe(3); // all three get played
    expect(run()).toEqual(a); // seeded: a replay of the same hits is exact
  });
});

describe('Cut previous', () => {
  /** Long Effects with a long release, so a step is still lit when the next one plays. */
  const long = (id: string, color: string): Effect =>
    parseEffect({ id, cell: KICK, generator: { kind: 'solid', style: 'solid', params: { color } }, amp: { attackMs: 0, length: { ms: 2000 }, releaseMs: 1000 } });
  const LONG = [long('r', '#ff0000'), long('g', '#00ff00'), long('b', '#0000ff')];

  it('without it, a step is still lit when the next one plays', () => {
    const h = harness([{ cell: KICK, mode: 'sequence' }], undefined, LONG);
    expect([h.strike(), h.strike()]).toEqual(['r', 'rg']);
  });

  it('with it, the step that plays stops the others at once — no release fade', () => {
    const h = harness([{ cell: KICK, mode: 'sequence', cut: true }], undefined, LONG);
    expect([h.strike(), h.strike(), h.strike(), h.strike()]).toEqual(['r', 'g', 'b', 'r']);
  });

  it('works on a Random cell too, and never on a Layer cell', () => {
    const random = harness([{ cell: KICK, mode: 'random', cut: true }], undefined, LONG);
    for (let i = 0; i < 6; i++) expect(random.strike()).toHaveLength(1);
    const layer = harness([{ cell: KICK, mode: 'layer', cut: true }], undefined, LONG);
    expect(layer.strike()).toBe('rgb');
  });
});
