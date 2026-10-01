/* Effect chains wave 5 (S07a) — MIDI-map InputMappings at the engine seam:
   setShow (show.mappings) → applyInput (note / CC / OSC) → tick → frame. A matched input is
   consumed before zones and Cues; discrete targets fire / recall; continuous targets write the
   live voices of their Effect every frame. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { parseEffect, type Effect, type EffectInput } from '../effect-chain/types';
import type { InputMapping } from '../effect-chain/input-mappings';
import { createVoiceBusEngine, type InputEvent, type RenderEngine } from './engine';
import type { VoiceDiagnostic } from './diagnostics';
import { emptyShow, type Show, type SongSection } from './types';

const DRUMS = ['kick', 'snare', 'tom'] as const;

function model(): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: DRUMS.map((id, i) => ({
      id, diameterIn: 12, hoopSpacingMm: 50, origin: { x: i * 400, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    })),
  }));
}

function transport(): TransportState {
  return { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
}

/** A white solid Effect with a long gate, so a frame shortly after the fire is lit. */
function solid(over: Partial<EffectInput> & Pick<EffectInput, 'id' | 'cell'>): Effect {
  return parseEffect({
    generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff' } },
    amp: { attackMs: 0, length: { ms: 5000 }, releaseMs: 10 },
    ...over,
  });
}

const zone = (row: string, slot = 0) => ({ row, column: { kind: 'zone' as const, slot } });

function section(id: string, effects: Effect[]): SongSection {
  return { id, name: id, slots: {}, effects };
}

function showOf(sections: SongSection[], mappings: unknown[]): Show {
  return { ...emptyShow(), songs: [{ id: 'song', name: 'Song', sections }], mappings: mappings as InputMapping[] };
}

interface Harness {
  engine: RenderEngine;
  diags: VoiceDiagnostic[];
  m: PixelModel;
  now: number;
  send(ev: Omit<InputEvent, 'timeMs'>, ms?: number): void;
  advance(ms: number): void;
}

function harness(show: Show): Harness {
  const engine = createVoiceBusEngine({ onDiagnostic: (d) => h.diags.push(d) });
  const m = model();
  engine.setModel(m);
  engine.setShow(show);
  const h: Harness = {
    engine, diags: [], m, now: 0,
    send(ev, ms = 20) {
      engine.applyInput({ ...ev, timeMs: h.now } as InputEvent);
      h.advance(ms);
    },
    advance(ms) {
      const end = h.now + ms;
      do {
        engine.tick(h.now, 10, transport());
        if (h.now >= end) break;
        h.now = Math.min(end, h.now + 10);
      } while (true);
    },
  };
  h.engine.tick(0, 0, transport());
  return h;
}

/** Mean red level over one drum (0..1 for a white solid at brightness 1). */
function level(h: Harness, drumId: string): number {
  const d = h.m.drumById.get(drumId)!;
  const frame = h.engine.frame();
  let sum = 0;
  for (let i = d.pixelStart; i < d.pixelStart + d.pixelCount; i++) sum += frame[i * 4]!;
  return sum / d.pixelCount;
}

function lit(h: Harness): string[] {
  return DRUMS.filter((id) => level(h, id) > 1e-6);
}

const fired = (h: Harness): string[] =>
  h.diags.flatMap((d) => (d.kind === 'effect-fired' ? [d.effectId] : []));

describe('InputMapping — discrete targets and precedence', () => {
  it('a note mapped to fireCell fires that cell and NOT the zone Effect the note would otherwise hit', () => {
    const kickZone = solid({ id: 'kick-zone', cell: zone('kick') });
    const snareCell = solid({ id: 'snare-cell', cell: zone('snare') });
    const h = harness(showOf([section('A', [kickZone, snareCell])], [
      { id: 'm1', source: { midiNote: 36 }, target: { kind: 'fireCell', cell: zone('snare') } },
    ]));
    // The host attached kick's zone to note 36 (zone-mapped) — the mapping still wins.
    h.send({ kind: 'noteOn', note: 36, drumId: 'kick', zone: '0', velocity: 1 });
    expect(fired(h)).toEqual(['snare-cell']);
    expect(lit(h)).toEqual(['snare']);
  });

  it('an unmapped zone note still fires its zone Effect (mappings only take what they match)', () => {
    const kickZone = solid({ id: 'kick-zone', cell: zone('kick') });
    const h = harness(showOf([section('A', [kickZone])], [
      { id: 'm1', source: { midiNote: 40 }, target: { kind: 'fireEffect', effectId: 'kick-zone' } },
    ]));
    h.send({ kind: 'noteOn', note: 36, drumId: 'kick', zone: '0', velocity: 1 });
    expect(fired(h)).toEqual(['kick-zone']);
  });

  it('fireCell fires every Effect stacked in the cell, bypassed excluded', () => {
    const a = solid({ id: 'a', cell: zone('tom') });
    const b = solid({ id: 'b', cell: zone('tom') });
    const off = solid({ id: 'off', cell: zone('tom'), bypass: true });
    const h = harness(showOf([section('A', [a, off, b])], [
      { id: 'm1', source: { midiNote: 50 }, target: { kind: 'fireCell', cell: zone('tom') } },
    ]));
    h.send({ kind: 'noteOn', note: 50, velocity: 1 });
    expect(fired(h)).toEqual(['a', 'b']);
  });

  it('a mapped note is consumed before a Cue on the same note', () => {
    const cue = solid({ id: 'cue', cell: { row: 'kick', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 60 } } });
    const target = solid({ id: 'target', cell: zone('tom') });
    const h = harness(showOf([section('A', [cue, target])], [
      { id: 'm1', source: { midiNote: 60 }, target: { kind: 'fireEffect', effectId: 'target' } },
    ]));
    h.send({ kind: 'noteOn', note: 60, velocity: 1 });
    expect(fired(h)).toEqual(['target']);
  });

  it('a CC mapped to fireEffect fires on the rising edge through half-way only, and never edges a CC Cue', () => {
    const cue = solid({ id: 'cc-cue', cell: { row: 'kick', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiCc: 20 } } });
    const target = solid({ id: 'target', cell: zone('tom'), retrigger: 'overlap' });
    const h = harness(showOf([section('A', [cue, target])], [
      { id: 'm1', source: { midiCc: 20 }, target: { kind: 'fireEffect', effectId: 'target' } },
    ]));
    for (const value of [10, 70, 90, 127, 20, 100]) h.send({ kind: 'cc', controller: 20, value });
    expect(fired(h)).toEqual(['target', 'target']); // 10→70 rises; 20→100 rises again
  });

  it('an OSC address mapped to fireEffect fires on each message, and an oscValue update never fires', () => {
    const target = solid({ id: 'target', cell: zone('tom'), retrigger: 'overlap' });
    const h = harness(showOf([section('A', [target])], [
      { id: 'm1', source: { oscAddress: '/hit' }, target: { kind: 'fireEffect', effectId: 'target' } },
    ]));
    h.send({ kind: 'oscValue', address: '/hit', value: 1 });
    expect(fired(h)).toEqual([]);
    h.send({ kind: 'osc', address: '/hit', value: 1 });
    expect(fired(h)).toEqual(['target']);
  });

  it('recallSection recalls the section of its own song when no songId is given', () => {
    const always = solid({ id: 'b-look', cell: { row: 'kick', column: { kind: 'always' } }, trigger: { kind: 'always' } });
    const h = harness(showOf([section('A', []), section('B', [always])], [
      { id: 'm1', source: { midiNote: 70 }, target: { kind: 'recallSection', sectionId: 'B' } },
    ]));
    h.send({ kind: 'recallSection', songId: 'song', sectionId: 'A' });
    expect(h.engine.getActiveSelection()).toEqual({ activeSongId: 'song', activeSectionId: 'A' });
    h.send({ kind: 'noteOn', note: 70, velocity: 1 });
    expect(h.engine.getActiveSelection()).toEqual({ activeSongId: 'song', activeSectionId: 'B' });
    expect(lit(h)).toEqual(['kick']);
  });

  it('a note-off of a mapped note releases the hold Effects its target fired', () => {
    const held = solid({ id: 'held', cell: zone('tom'), amp: { attackMs: 0, length: 'hold', releaseMs: 10 } });
    const h = harness(showOf([section('A', [held])], [
      { id: 'm1', source: { midiNote: 50 }, target: { kind: 'fireEffect', effectId: 'held' } },
    ]));
    h.send({ kind: 'noteOn', note: 50, velocity: 1 }, 200);
    expect(lit(h)).toEqual(['tom']);
    h.send({ kind: 'noteOff', note: 50 }, 100);
    expect(lit(h)).toEqual([]);
  });

  it('a bypass mapping is consumed (the web store toggles it) and fires nothing', () => {
    const kickZone = solid({ id: 'kick-zone', cell: zone('kick') });
    const h = harness(showOf([section('A', [kickZone])], [
      { id: 'm1', source: { midiNote: 36 }, target: { kind: 'bypass', effectId: 'kick-zone' } },
    ]));
    h.send({ kind: 'noteOn', note: 36, drumId: 'kick', zone: '0', velocity: 1 });
    expect(fired(h)).toEqual([]);
    expect(lit(h)).toEqual([]);
  });

  it('invalid stored mappings are ignored and never consume input', () => {
    const kickZone = solid({ id: 'kick-zone', cell: zone('kick') });
    const h = harness(showOf([section('A', [kickZone])], [
      { id: 'bad', source: { midiNote: 36, midiCc: 1 }, target: { kind: 'fireEffect', effectId: 'kick-zone' } },
      { id: 'bad2', source: { midiNote: 36 }, target: { kind: 'nope' } },
    ]));
    h.send({ kind: 'noteOn', note: 36, drumId: 'kick', zone: '0', velocity: 1 });
    expect(fired(h)).toEqual(['kick-zone']);
  });
});

/*
 * Continuous targets are checked against a twin engine that runs the same clock with the
 * target AUTHORED at the value the mapping should produce: "the knob at X renders exactly
 * what authoring X renders". That pins the semantics (the mapping sets the base value) without
 * hard-coding the generator's pixel levels.
 */
describe('InputMapping — continuous targets on live voices', () => {
  const look = (over: Partial<EffectInput> = {}): Effect =>
    solid({ id: 'look', cell: { row: 'kick', column: { kind: 'always' } }, trigger: { kind: 'always' }, ...over });

  interface Twin {
    mapped: Harness;
    /** Send to the mapped engine; the reference only advances the same time. */
    send(ev: Omit<InputEvent, 'timeMs'>): void;
    /** The mapped frame equals a fresh reference authored with `over`, at the same clock. */
    expectAuthored(over: Partial<EffectInput>): void;
  }

  function twin(mappings: unknown[], over: Partial<EffectInput> = {}): Twin {
    const mapped = harness(showOf([section('A', [look(over)])], mappings));
    mapped.send({ kind: 'recallSection', songId: 'song', sectionId: 'A' }, 50);
    return {
      mapped,
      send(ev) {
        mapped.send(ev);
      },
      expectAuthored(authored) {
        const ref = harness(showOf([section('A', [look({ ...over, ...authored })])], []));
        ref.send({ kind: 'recallSection', songId: 'song', sectionId: 'A' }, mapped.now);
        expect(ref.now).toBe(mapped.now);
        expect(Array.from(mapped.engine.frame())).toEqual(Array.from(ref.engine.frame()));
      },
    };
  }

  const brightness = (value: number): Partial<EffectInput> =>
    ({ generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff', brightness: value } } });

  it('a CC mapped to a generator param changes an ALREADY-PLAYING voice live, over the param range', () => {
    const t = twin([{ id: 'm1', source: { midiCc: 21 }, target: { kind: 'param', effectId: 'look', device: 'generator', param: 'brightness' } }]);
    t.expectAuthored({}); // an untouched knob leaves the authored value alone
    expect(level(t.mapped, 'kick')).toBeGreaterThan(0.5);
    t.send({ kind: 'cc', controller: 21, value: 0 });
    expect(level(t.mapped, 'kick')).toBe(0);
    t.send({ kind: 'cc', controller: 21, value: 127 });
    t.expectAuthored(brightness(1));
    t.send({ kind: 'cc', controller: 21, value: 127 / 2 });
    t.expectAuthored(brightness(0.5));
  });

  it('rangeMin / rangeMax scale the input (a reversed range runs the knob backwards)', () => {
    const t = twin([{ id: 'm1', source: { midiCc: 21 }, rangeMin: 0.8, rangeMax: 0.2,
      target: { kind: 'param', effectId: 'look', device: 'generator', param: 'brightness' } }]);
    t.send({ kind: 'cc', controller: 21, value: 0 });
    t.expectAuthored(brightness(0.8));
    t.send({ kind: 'cc', controller: 21, value: 127 });
    t.expectAuthored(brightness(0.2));
  });

  it('an OSC address mapped to opacity fades the Effect layer', () => {
    const t = twin([{ id: 'm1', source: { oscAddress: '/fader' }, target: { kind: 'opacity', effectId: 'look' } }]);
    t.send({ kind: 'oscValue', address: '/fader', value: 0.25 });
    t.expectAuthored({ opacity: 0.25 });
    t.send({ kind: 'osc', address: '/fader', value: 1 });
    t.expectAuthored({ opacity: 1 });
  });

  it('a CC mapped to a modifier param drives that link of the chain', () => {
    const chain = (b: number): Partial<EffectInput> => ({ modifiers: [{ uid: 'lv', modifierId: 'levels', params: { brightness: b } }] });
    const t = twin([{ id: 'm1', source: { midiCc: 22 },
      target: { kind: 'param', effectId: 'look', device: 'lv', param: 'brightness' } }], chain(0));
    expect(level(t.mapped, 'kick')).toBe(0); // levels at brightness 0 blacks the look
    t.send({ kind: 'cc', controller: 22, value: 127 });
    t.expectAuthored(chain(2)); // the modifier param's own range: levels brightness is 0..2
  });

  it('a CC mapped to a modifier mix sets the dry/wet of that link', () => {
    const chain = (mix: number): Partial<EffectInput> => ({ modifiers: [{ uid: 'lv', modifierId: 'levels', params: { brightness: 0 }, mix }] });
    const t = twin([{ id: 'm1', source: { midiCc: 23 }, target: { kind: 'modifierMix', effectId: 'look', modifierUid: 'lv' } }], chain(1));
    t.send({ kind: 'cc', controller: 23, value: 0 });
    t.expectAuthored(chain(0));
    expect(level(t.mapped, 'kick')).toBeGreaterThan(0); // fully dry: the look shows through
  });

  it('a note mapped to a continuous target is a gate: held = rangeMax, released = rangeMin', () => {
    const t = twin([{ id: 'm1', source: { midiNote: 64 }, rangeMin: 0.1, rangeMax: 0.9, target: { kind: 'opacity', effectId: 'look' } }]);
    t.send({ kind: 'noteOn', note: 64, velocity: 1 });
    t.expectAuthored({ opacity: 0.9 });
    t.send({ kind: 'noteOff', note: 64 });
    t.expectAuthored({ opacity: 0.1 });
  });

  it('a mapping follows the ACTIVE section: it only reaches the Effect once its section is recalled', () => {
    const lookA = solid({ id: 'a', cell: { row: 'kick', column: { kind: 'always' } }, trigger: { kind: 'always' } });
    const lookB = solid({ id: 'b', cell: { row: 'kick', column: { kind: 'always' } }, trigger: { kind: 'always' } });
    const h = harness(showOf([section('A', [lookA]), section('B', [lookB])], [
      { id: 'm1', source: { midiCc: 21 }, target: { kind: 'param', effectId: 'b', device: 'generator', param: 'brightness' } },
    ]));
    h.send({ kind: 'recallSection', songId: 'song', sectionId: 'A' }, 50);
    h.send({ kind: 'cc', controller: 21, value: 0 });
    expect(level(h, 'kick')).toBeGreaterThan(0.5); // A's look is not the target
    h.send({ kind: 'recallSection', songId: 'song', sectionId: 'B' }, 200);
    expect(level(h, 'kick')).toBe(0); // the heard knob holds B's look down from its first frame
  });

  it('a mapping to an unknown Effect, modifier or non-number param is inert (and still consumed)', () => {
    const t = twin([
      { id: 'm1', source: { midiCc: 21 }, target: { kind: 'param', effectId: 'look', device: 'generator', param: 'color' } },
      { id: 'm2', source: { midiCc: 22 }, target: { kind: 'modifierMix', effectId: 'look', modifierUid: 'nope' } },
      { id: 'm3', source: { midiCc: 23 }, target: { kind: 'opacity', effectId: 'gone' } },
    ]);
    for (const controller of [21, 22, 23]) t.send({ kind: 'cc', controller, value: 0 });
    t.expectAuthored({});
  });
});

