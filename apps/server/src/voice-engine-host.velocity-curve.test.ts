import { describe, expect, it } from 'vitest';
import { defaultProject, voice, withVelocityCurve, type CurveValue, type PixelModel } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { OutputManager } from './output-manager';
import { VoiceEngineHost } from './voice-engine-host';

/* Per-drum velocity sensitivity, server half (S8).

   THE RULE: an input the zone-map CLAIMS for a drum is shaped by that drum's curve; an
   unclaimed one — a direct-bound note, a modulation-only address — passes through untouched.
   `toInputEvent` is the ONE seam where the raw value and the resolved drum first coexist, so
   these assert on the events the host hands the engine: one input in, one shaped value out. */

class FakeOutput implements PixelOutput {
  nextFrame(): void {}
  send(): void {}
  close(): void {}
}

class RecordingEngine implements voice.RenderEngine {
  readonly events: voice.InputEvent[] = [];
  private fb = new Float32Array(0);
  setModel(model: PixelModel): void {
    this.fb = new Float32Array(model.pixelCount * 4);
  }
  setShow(): void {}
  applyInput(ev: voice.InputEvent): void {
    this.events.push(ev);
  }
  tick(): void {}
  frame(): Readonly<Float32Array> {
    return this.fb;
  }
  stats(): voice.EngineStats {
    return {
      timeMs: 0,
      beat: 0,
      voiceCount: 0,
      busLevels: {},
      voices: [],
      perf: { tickMs: 0, queueMs: 0, pendingMs: 0, envelopeMs: 0, paramsMs: 0, compositeMs: 0, voiceCount: 0 },
    };
  }
}

/** Halves everything: out = in / 2, so the expected number is arithmetic, not a shape guess. */
const HALF: CurveValue = { h0: { x: 0, y: 0 }, h1: { x: 1, y: 0.5 }, profile: 'linear', strength: 0 };

/** defaultProject maps note 36 → kick — a real zone-map hit to shape. */
const MAPPED_NOTE = 36;
const KICK = 'kick';

function makeHost(curved = true) {
  const engine = new RecordingEngine();
  const project = defaultProject();
  const host = new VoiceEngineHost(project, engine, new OutputManager(() => new FakeOutput()));
  if (curved) host.setInputMap(withVelocityCurve(project.inputMap, KICK, HALF));
  return { host, engine, project };
}

describe('velocity sensitivity at the input seam', () => {
  it('shapes a zone-mapped MIDI hit by its drum’s curve', () => {
    const { host, engine, project } = makeHost();
    expect(project.inputMap.midiNotes.some((m) => m.note === MAPPED_NOTE && m.drumId === KICK)).toBe(true);

    host.applyInput({ kind: 'noteOn', note: MAPPED_NOTE, velocity: 0.8 });

    expect(engine.events).toHaveLength(1);
    const ev = engine.events[0]!;
    expect(ev.kind).toBe('noteOn');
    expect(ev.drumId).toBe(KICK);
    expect(ev.velocity).toBeCloseTo(0.4, 6);
  });

  it('leaves an UNCLAIMED note untouched — no drum, no curve', () => {
    const { host, engine, project } = makeHost();
    const free = 99;
    expect(project.inputMap.midiNotes.some((m) => m.note === free)).toBe(false);

    host.applyInput({ kind: 'noteOn', note: free, velocity: 0.8 });

    const ev = engine.events[0]!;
    expect(ev.drumId).toBeUndefined();
    expect(ev.velocity).toBe(0.8);
  });

  it('leaves a drum with no curve of its own untouched', () => {
    const { host, engine, project } = makeHost();
    const other = project.inputMap.midiNotes.find((m) => m.drumId !== KICK);
    expect(other).toBeDefined();

    host.applyInput({ kind: 'noteOn', note: other!.note, velocity: 0.8 });

    expect(engine.events[0]!.velocity).toBe(0.8);
  });

  it('shapes a pad hit (`key`) the same way — the test fire agrees with the stick', () => {
    const { host, engine } = makeHost();

    host.applyInput({ kind: 'key', drumId: KICK, zone: '0', velocity: 0.8 });

    expect(engine.events[0]!.velocity).toBeCloseTo(0.4, 6);
  });

  it('shapes a zone-mapped OSC hit — an SP address IS a drum trigger', () => {
    const { host, engine, project } = makeHost(false);
    const address = '/sp/kick/center';
    host.setInputMap(
      withVelocityCurve(
        { ...project.inputMap, oscMap: [{ address, drumId: KICK, slot: 0 }] },
        KICK,
        HALF,
      ),
    );

    host.applyInput({ kind: 'osc', address, value: 0.8 });

    const ev = engine.events[0]!;
    expect(ev.drumId).toBe(KICK);
    expect(ev.value).toBeCloseTo(0.4, 6);
  });

  it('leaves an unmapped OSC address raw — a modulation source must read what was sent', () => {
    const { host, engine } = makeHost();

    host.applyInput({ kind: 'osc', address: '/some/modulation', value: 0.8 });

    expect(engine.events[0]!.value).toBe(0.8);
  });

  it('does NOT shape an explicit graph fire — it carries a key, not an input identity', () => {
    const { host, engine } = makeHost();

    host.applyInput({ kind: 'fireGraph', graphKey: 'kick:0', velocity: 0.8 });

    expect(engine.events[0]!.velocity).toBe(0.8);
  });

  it('is exactly today’s behaviour with no curves authored anywhere', () => {
    const { host, engine } = makeHost(false);

    host.applyInput({ kind: 'noteOn', note: MAPPED_NOTE, velocity: 0.8 });
    host.applyInput({ kind: 'key', drumId: KICK, zone: '0', velocity: 0.37 });

    expect(engine.events[0]!.velocity).toBe(0.8);
    expect(engine.events[1]!.velocity).toBe(0.37);
  });

  it('follows a live curve edit — the next hit uses the map just set', () => {
    const { host, engine, project } = makeHost(false);

    host.applyInput({ kind: 'noteOn', note: MAPPED_NOTE, velocity: 0.8 });
    host.setInputMap(withVelocityCurve(project.inputMap, KICK, HALF));
    host.applyInput({ kind: 'noteOn', note: MAPPED_NOTE, velocity: 0.8 });

    expect(engine.events[0]!.velocity).toBe(0.8);
    expect(engine.events[1]!.velocity).toBeCloseTo(0.4, 6);
  });
});
