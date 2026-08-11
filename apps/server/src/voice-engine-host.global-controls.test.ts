import { describe, expect, it } from 'vitest';
import { defaultProject, voice, withGlobalControlBinding, type PixelModel } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { OutputManager } from './output-manager';
import { VoiceEngineHost } from './voice-engine-host';

/* Global control bindings, server half: PRECEDENCE.

   A note or address bound to a global control is CONSUMED at input step 0 — it becomes
   the action and must never ALSO reach the zone-map (a pad) or a trigger-source graph,
   mirroring the CC #0 section-recall reservation.

   These assert on the events the host hands the engine, because that is precisely where
   the precedence decision lands: one input in, exactly one kind of event out. */

class FakeOutput implements PixelOutput {
  nextFrame(): void {}
  send(): void {}
  close(): void {}
}

/** A RenderEngine that records the events it is given and does nothing else. */
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

function makeHost() {
  const engine = new RecordingEngine();
  const project = defaultProject();
  const host = new VoiceEngineHost(project, engine, new OutputManager(() => new FakeOutput()));
  return { host, engine, project };
}

/** defaultProject maps note 36 → kick, so it is a real zone-map hit to steal. */
const MAPPED_NOTE = 36;

describe('global control precedence — MIDI notes', () => {
  it('converts a bound note into its action instead of a pad hit', () => {
    const { host, engine, project } = makeHost();
    expect(project.inputMap.midiNotes.some((m) => m.note === MAPPED_NOTE)).toBe(true); // it IS zone-mapped
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSong', { midiNote: MAPPED_NOTE }),
    });

    host.applyInput({ kind: 'noteOn', note: MAPPED_NOTE, velocity: 1 });

    expect(engine.events).toHaveLength(1);
    expect(engine.events[0]!.kind).toBe('globalControl');
    expect(engine.events[0]!.action).toBe('nextSong');
    // The consumption that matters: no pad was attached, so nothing fires the drum.
    expect(engine.events[0]!.drumId).toBeUndefined();
  });

  it('leaves an unbound note on the normal zone-map path', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSong', { midiNote: 100 }),
    });

    host.applyInput({ kind: 'noteOn', note: MAPPED_NOTE, velocity: 1 });

    expect(engine.events[0]!.kind).toBe('noteOn');
    expect(engine.events[0]!.drumId).toBe('kick'); // still resolved to its pad
  });

  it('consumes a bound note that is NOT zone-mapped (no direct-binding fallthrough)', () => {
    const { host, engine, project } = makeHost();
    const freeNote = 100;
    expect(project.inputMap.midiNotes.some((m) => m.note === freeNote)).toBe(false);
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'prevSection', { midiNote: freeNote }),
    });

    host.applyInput({ kind: 'noteOn', note: freeNote, velocity: 1 });

    expect(engine.events[0]!.kind).toBe('globalControl');
    expect(engine.events[0]!.action).toBe('prevSection');
    expect(engine.events[0]!.note).toBeUndefined(); // no raw note forwarded to re-resolve
  });

  it('routes every action id to its own event', () => {
    const { host, engine, project } = makeHost();
    let controls = {};
    const notes = { nextSong: 100, prevSong: 101, nextSection: 102, prevSection: 103 } as const;
    for (const [action, note] of Object.entries(notes)) {
      controls = withGlobalControlBinding(controls, action as keyof typeof notes, { midiNote: note });
    }
    host.setInputMap({ ...project.inputMap, globalControls: controls });

    for (const note of Object.values(notes)) host.applyInput({ kind: 'noteOn', note, velocity: 1 });

    expect(engine.events.map((e) => e.action)).toEqual(Object.keys(notes));
  });

  it('does not consume the note-off (it carries no action and is inert)', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSong', { midiNote: MAPPED_NOTE }),
    });

    host.applyInput({ kind: 'noteOff', note: MAPPED_NOTE });

    expect(engine.events[0]!.kind).toBe('noteOff');
  });
});

describe('global control precedence — OSC', () => {
  it('converts a bound address into its action instead of an OSC input', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSection', { oscAddress: '/ledrums/next' }),
    });

    host.applyInput({ kind: 'osc', address: '/ledrums/next', value: 1 });

    expect(engine.events).toHaveLength(1);
    expect(engine.events[0]!.kind).toBe('globalControl');
    expect(engine.events[0]!.action).toBe('nextSection');
  });

  it('consumes a zero argument WITHOUT firing — the release half of a button press', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSection', { oscAddress: '/ledrums/next' }),
    });

    host.applyInput({ kind: 'osc', address: '/ledrums/next', value: 1 });
    host.applyInput({ kind: 'osc', address: '/ledrums/next', value: 0 });

    // One press+release = ONE navigation, and the release never falls through to a pad.
    expect(engine.events).toHaveLength(1);
    expect(engine.events[0]!.action).toBe('nextSection');
  });

  it('leaves an unbound address on the normal OSC path', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSection', { oscAddress: '/ledrums/next' }),
    });

    host.applyInput({ kind: 'osc', address: '/kick', value: 1 });

    expect(engine.events[0]!.kind).toBe('osc');
    expect(engine.events[0]!.address).toBe('/kick');
  });

  it('does not match a prefix of a bound address', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSection', { oscAddress: '/ledrums/next' }),
    });

    host.applyInput({ kind: 'osc', address: '/ledrums/next/section', value: 1 });

    expect(engine.events[0]!.kind).toBe('osc');
  });
});

describe('global control precedence — no bindings', () => {
  it('changes nothing when no control is bound (the default project)', () => {
    const { host, engine } = makeHost();
    host.applyInput({ kind: 'noteOn', note: MAPPED_NOTE, velocity: 1 });
    host.applyInput({ kind: 'osc', address: '/kick', value: 1 });
    expect(engine.events.map((e) => e.kind)).toEqual(['noteOn', 'osc']);
  });
});
