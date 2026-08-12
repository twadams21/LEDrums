import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('swallows the note-off of a bound TRIGGER note (consumed, no edge)', () => {
    // A trigger has no held state, so its release is consumed and dropped — it must
    // reach neither the engine as an edge nor a pad as a raw noteOff.
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSong', { midiNote: MAPPED_NOTE }),
    });

    host.applyInput({ kind: 'noteOff', note: MAPPED_NOTE });

    expect(engine.events).toHaveLength(0);
  });

  it('forwards the note-off of an UNBOUND note unchanged', () => {
    const { host, engine } = makeHost();
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

describe('momentary blackout — the note-off edge', () => {
  const bind = () => {
    const h = makeHost();
    h.host.setInputMap({
      ...h.project.inputMap,
      globalControls: withGlobalControlBinding({}, 'panicBlackoutMomentary', { midiNote: 100 }),
    });
    return h;
  };

  it('sends pressed:true on note-on and pressed:false on note-off', () => {
    const { host, engine } = bind();
    host.applyInput({ kind: 'noteOn', note: 100, velocity: 1 });
    host.applyInput({ kind: 'noteOff', note: 100 });

    expect(engine.events.map((e) => [e.kind, e.action, e.pressed])).toEqual([
      ['globalControl', 'panicBlackoutMomentary', true],
      ['globalControl', 'panicBlackoutMomentary', false],
    ]);
  });

  it('maps an OSC nonzero/zero pair to the same press/release edges', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'panicBlackoutMomentary', { oscAddress: '/panic' }),
    });
    host.applyInput({ kind: 'osc', address: '/panic', value: 1 });
    host.applyInput({ kind: 'osc', address: '/panic', value: 0 });

    expect(engine.events.map((e) => e.pressed)).toEqual([true, false]);
  });

  it('a NON-momentary bound note swallows its note-off entirely', () => {
    // A trigger's release must not reach the engine at all — not as an edge, and not as
    // a raw noteOff that could leak to a pad.
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'nextSong', { midiNote: 100 }),
    });
    host.applyInput({ kind: 'noteOn', note: 100, velocity: 1 });
    host.applyInput({ kind: 'noteOff', note: 100 });

    expect(engine.events).toHaveLength(1);
    expect(engine.events[0]!.action).toBe('nextSong');
  });
});

describe('master brightness — the CC binding', () => {
  const bind = (cc: number) => {
    const h = makeHost();
    h.host.setInputMap({
      ...h.project.inputMap,
      globalControls: withGlobalControlBinding({}, 'masterBrightness', { midiCc: cc }),
    });
    return h;
  };

  it('converts a bound CC into a continuous action, normalised to 0..1', () => {
    const { host, engine } = bind(7);
    host.applyInput({ kind: 'cc', controller: 7, value: 127 });
    expect(engine.events[0]!.kind).toBe('globalControl');
    expect(engine.events[0]!.action).toBe('masterBrightness');
    expect(engine.events[0]!.value).toBe(1);
  });

  it('CONSUMES it — a bound CC never also feeds the modulation CC table', () => {
    const { host, engine } = bind(7);
    host.applyInput({ kind: 'cc', controller: 7, value: 64 });
    expect(engine.events).toHaveLength(1);
    expect(engine.events.some((e) => e.kind === 'cc')).toBe(false);
  });

  it('leaves an unbound CC on the modulation path', () => {
    const { host, engine } = bind(7);
    host.applyInput({ kind: 'cc', controller: 8, value: 64 });
    expect(engine.events[0]!.kind).toBe('cc');
    expect(engine.events[0]!.value).toBe(64); // raw 0..127 preserved for the CC table
  });

  it('never steals reserved controller 0, even when bound to it', () => {
    const { host, engine } = bind(0);
    host.applyInput({ kind: 'cc', controller: 0, value: 64 });
    expect(engine.events[0]!.kind).toBe('cc'); // section recall keeps CC 0
  });

  it('an OSC zero on a continuous control is a REAL value, not a release', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'masterBrightness', { oscAddress: '/dim' }),
    });
    host.applyInput({ kind: 'osc', address: '/dim', value: 0 });
    expect(engine.events).toHaveLength(1);
    expect(engine.events[0]!.value).toBe(0); // fully dark, forwarded
  });

  it('clamps an out-of-range OSC value', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'masterBrightness', { oscAddress: '/dim' }),
    });
    host.applyInput({ kind: 'osc', address: '/dim', value: 5 });
    expect(engine.events[0]!.value).toBe(1);
  });
});

describe('host-level controls never reach the engine', () => {
  it('consumes transmit toggle and flips the mute', () => {
    const { host, engine, project } = makeHost();
    host.setInputMap({
      ...project.inputMap,
      globalControls: withGlobalControlBinding({}, 'transmitToggle', { midiNote: 100 }),
    });

    expect(host.isTransmitMuted()).toBe(false);
    host.applyInput({ kind: 'noteOn', note: 100, velocity: 1 });
    expect(host.isTransmitMuted()).toBe(true);
    host.applyInput({ kind: 'noteOn', note: 100, velocity: 1 });
    expect(host.isTransmitMuted()).toBe(false);

    expect(engine.events).toHaveLength(0); // the engine never saw any of it
  });

  it('a muted host stops sending frames but keeps rendering the preview', () => {
    const sends: number[] = [];
    const out = new (class extends FakeOutput {
      override send(): void {
        sends.push(1);
      }
    })();
    const project = defaultProject();
    project.output.state = 'armed';
    project.output.fps = 120;
    const host = new VoiceEngineHost(project, null, new OutputManager(() => out));
    host.reloadOutputSettings();
    let previews = 0;
    host.onFrame = () => previews++;

    for (let i = 0; i < 30; i++) host.step(1000 / 120);
    const sentWhileLive = sends.length;
    const previewedWhileLive = previews;
    expect(sentWhileLive).toBeGreaterThan(0);

    host.setTransmitMuted(true);
    for (let i = 0; i < 30; i++) host.step(1000 / 120);

    expect(sends.length).toBe(sentWhileLive); // nothing more went out on the wire
    expect(previews).toBeGreaterThan(previewedWhileLive); // the operator still sees the show
  });
});

describe('tap tempo', () => {
  /** Tap `n` times `gapMs` apart, driving the host's wall clock via fake timers. */
  function tap(host: VoiceEngineHost, n: number, gapMs: number): void {
    for (let i = 0; i < n; i++) {
      if (i > 0) vi.advanceTimersByTime(gapMs);
      host.applyInput({ kind: 'noteOn', note: 100, velocity: 1 });
    }
  }

  function bound() {
    const h = makeHost();
    h.host.setInputMap({
      ...h.project.inputMap,
      globalControls: withGlobalControlBinding({}, 'tapTempo', { midiNote: 100 }),
    });
    return h;
  }

  // The tap clock is `performance.now()` (wall time — the operator taps in real time),
  // which is NOT faked by default; without this the taps all share one timestamp and
  // the tests pass vacuously against the 120bpm default.
  beforeEach(() => vi.useFakeTimers({ toFake: ['performance'] }));
  afterEach(() => vi.useRealTimers());

  it('needs 3 taps — one or two never change the tempo', () => {
    const { host, project, engine } = bound();
    const before = project.composition.transport.bpm;
    tap(host, 2, 500);
    expect(project.composition.transport.bpm).toBe(before);
    expect(engine.events).toHaveLength(0); // and the engine never sees a host-level action
  });

  it('sets the bpm from the tap interval', () => {
    const { host, project } = bound();
    tap(host, 4, 500); // 500ms apart = 120bpm
    expect(project.composition.transport.bpm).toBe(120);
  });

  it('follows a different tempo', () => {
    const { host, project } = bound();
    tap(host, 4, 400); // 400ms = 150bpm
    expect(project.composition.transport.bpm).toBe(150);
  });

  it('notifies so the server can rebroadcast the transport', () => {
    const { host, project } = bound();
    let notified = 0;
    host.onTransportChanged = () => notified++;
    // 400ms = 150bpm — deliberately NOT the 120bpm default, or the no-op guard would
    // (correctly) skip the broadcast and this would prove nothing.
    tap(host, 4, 400);
    expect(notified).toBeGreaterThan(0);
    expect(project.composition.transport.bpm).toBe(150);
  });

  it('does NOT rebroadcast when the tapped tempo matches the current one', () => {
    const { host, project } = bound();
    let notified = 0;
    host.onTransportChanged = () => notified++;
    tap(host, 4, 500); // 120bpm — already the default
    expect(project.composition.transport.bpm).toBe(120);
    expect(notified).toBe(0);
  });

  it('starts a fresh series after a long gap, so a stale tap cannot drag the average', () => {
    const { host, project } = bound();
    tap(host, 3, 500); // 120bpm
    expect(project.composition.transport.bpm).toBe(120);

    vi.advanceTimersByTime(10_000); // way past the reset window
    tap(host, 2, 400); // only 2 taps in the new series → not enough to commit
    expect(project.composition.transport.bpm).toBe(120);

    vi.advanceTimersByTime(400);
    host.applyInput({ kind: 'noteOn', note: 100, velocity: 1 }); // 3rd of the new series
    expect(project.composition.transport.bpm).toBe(150);
  });

  it('ignores an implausible tempo rather than lurching', () => {
    const { host, project } = bound();
    const before = project.composition.transport.bpm;
    tap(host, 4, 10); // 6000bpm
    expect(project.composition.transport.bpm).toBe(before);
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
