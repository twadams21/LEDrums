import { describe, expect, it } from 'vitest';
import { defaultProject, effectChain, voice } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { OutputManager } from './output-manager';
import { VoiceEngineHost } from './voice-engine-host';

class FakeOutput implements PixelOutput {
  sends = 0;
  closed = false;
  nextFrame(): void {}
  send(): void {
    this.sends++;
  }
  close(): void {
    this.closed = true;
  }
}

/** A kit-target struck-drum flash (the Solid Generator's Simple Style) on `row`, 200ms long. */
function flash(id: string, over: Record<string, unknown>): effectChain.Effect {
  return effectChain.parseEffect({
    id,
    generator: { kind: 'solid', style: 'simple', params: { hue: 60, brightness: 1 } },
    amp: { attackMs: 0, length: { ms: 200 }, releaseMs: 200 },
    target: { kind: 'kit' },
    ...over,
  });
}

/** A Cue flash on a raw MIDI note or OSC address. */
function cueFlash(id: string, source: Record<string, unknown>): effectChain.Effect {
  return flash(id, { cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source } });
}

function showOf(...effects: effectChain.Effect[]): voice.Show {
  return { songs: [{ id: 'song', name: 'Song', sections: [{ id: 'section', name: 'Section', effects }] }] };
}

/**
 * A minimal Show: one flash Effect on the `(drumId, zone)` cell. attackMs=0 so the voice reaches
 * full level on the first tick; brightness=1 so the compositor emits light.
 */
function makeShow(drumId: string, zone: string): voice.Show {
  return showOf(flash('fx-flash', { cell: { row: drumId, column: { kind: 'zone', slot: Number(zone) } } }));
}

function makeHost(engine?: voice.RenderEngine) {
  const fake = new FakeOutput();
  const project = defaultProject();
  project.output.state = 'armed';
  project.output.fps = 60;
  const host = new VoiceEngineHost(project, engine ?? null, new OutputManager(() => fake));
  host.reloadOutputSettings();
  return { host, fake, project };
}

const STEP = 1000 / 120;

function frameMax(rgb: Uint8Array): number {
  let mx = 0;
  for (let i = 0; i < rgb.length; i++) if (rgb[i]! > mx) mx = rgb[i]!;
  return mx;
}

describe('VoiceEngineHost', () => {
  it('starts black, then lights up after a key hit fires its Effect', () => {
    const { host } = makeHost();
    host.setShow(makeShow('kick', '0'));

    let last: Uint8Array | null = null;
    host.onFrame = (rgb) => {
      last = rgb;
    };

    // Warm up: no input yet → preview emits a black frame.
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(last).not.toBeNull();
    expect(last!.length).toBe(host.getModel().pixelCount * 3);
    expect(frameMax(last!)).toBe(0);
    expect(host.getStats().engine.voiceCount).toBe(0);

    // Native pad hit → a voice spawns and the kit-scoped flash fills the frame.
    host.applyInput({ kind: 'key', drumId: 'kick', zone: '0', velocity: 1 });
    for (let i = 0; i < 8; i++) host.step(STEP);

    expect(host.getStats().engine.voiceCount).toBeGreaterThan(0);
    expect(frameMax(last!)).toBeGreaterThan(0);
  });

  it('resolves a mapped MIDI note to its drum via the project inputMap', () => {
    const { host, project } = makeHost();
    // defaultProject maps note 36 → kick/slot 0. The pad zone is the slot index as a string,
    // so the Effect's cell must name the slot the inputMap resolves.
    const map = project.inputMap.midiNotes.find((m) => m.note === 36)!;
    expect(map.drumId).toBe('kick');
    host.setShow(makeShow('kick', String(map.slot)));

    host.applyInput({ kind: 'noteOn', note: 36, velocity: 1 });
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(host.getStats().engine.voiceCount).toBeGreaterThan(0);
  });

  // Regression (the drummer's silent rig, 2026-07-26). A Sensory Percussion zone lands on a
  // NON-ZERO slot, so this cannot pass by accident via a '0' default. The inputMap resolved
  // the note to zone 'rim-tip' (a SLOT_LABELS label) while the authored content was keyed
  // by slot index, so the pad lookup missed and every hit reported a miss — even though the
  // identical hit from the web UI worked, because only the MIDI/OSC path converted the slot
  // to a label.
  it('fires the zone Effect for a mapped note on a non-zero zone slot', () => {
    const { host, project } = makeHost();
    project.inputMap.midiNotes = [{ note: 66, drumId: 'snare', slot: 2 }];
    host.setShow(makeShow('snare', '2'));

    host.applyInput({ kind: 'noteOn', note: 66, velocity: 1 });
    for (let i = 0; i < 8; i++) host.step(STEP);

    expect(host.getStats().engine.voiceCount).toBeGreaterThan(0);
  });

  it('an unmapped MIDI note fires nothing (no voice) and does not throw', () => {
    const { host } = makeHost();
    host.setShow(makeShow('kick', '0'));
    expect(() => host.applyInput({ kind: 'noteOn', note: 7, velocity: 1 })).not.toThrow();
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(host.getStats().engine.voiceCount).toBe(0);
  });

  it('advances engineTimeMs by the tick size each step', () => {
    const { host } = makeHost(voice.createNullEngine());
    host.step(STEP);
    host.step(STEP);
    expect(host.engineTimeMs).toBeCloseTo(STEP * 2);
  });

  it('transmits frames to the output transport when armed', () => {
    const { host, fake } = makeHost(voice.createNullEngine());
    // output.fps=60, tick=120fps → a transmit lands within a few steps.
    for (let i = 0; i < 6; i++) host.step(STEP);
    expect(fake.sends).toBeGreaterThan(0);
  });

  it('reports voice/bus telemetry from the engine stats', () => {
    const { host } = makeHost();
    host.setShow(makeShow('kick', '0'));
    host.applyInput({ kind: 'key', drumId: 'kick', zone: '0', velocity: 1 });
    for (let i = 0; i < 4; i++) host.step(STEP);
    const stats = host.getStats();
    expect(stats.engine.voiceCount).toBeGreaterThan(0);
    expect(stats.engine.busLevels).toHaveProperty(effectChain.CHAIN_BUS_ID);
    expect(stats.engine.busLevels[effectChain.CHAIN_BUS_ID]).toBeGreaterThan(0);
  });

  it('streams per-voice detail so a connected dock can render server-truth voices (S17)', () => {
    const { host } = makeHost();
    host.setShow(makeShow('kick', '0'));
    host.applyInput({ kind: 'key', drumId: 'kick', zone: '0', velocity: 1 });
    for (let i = 0; i < 4; i++) host.step(STEP);

    const { voices } = host.getStats().engine;
    expect(voices.length).toBe(host.getStats().engine.voiceCount);
    expect(voices.length).toBeGreaterThan(0);
    const v = voices[0]!;
    expect(v.id).toBeTruthy();
    expect(typeof v.busId).toBe('string');
    expect(typeof v.effectId).toBe('string');
    expect(v.level).toBeGreaterThanOrEqual(0);
    expect(typeof v.releasing).toBe('boolean');
  });

  it('blacks out and closes the transport on stop', () => {
    const { host, fake } = makeHost(voice.createNullEngine());
    host.step(STEP);
    host.stop();
    expect(fake.closed).toBe(true);
  });

  it('setKitOutputs reorders the transmitted pixels live (dmxMap patch order)', () => {
    const { host } = makeHost(voice.createNullEngine());
    const model = host.getModel();
    // Default kit declares no outputs → a flat map whose first transmitted pixel is id 0.
    const before = host.getDmxMap().universes[0]!.pixels[0]!.id;
    expect(before).toBe(0);

    // A single output (one data line) reversing the drum order: last drum patched first.
    const reversed = model.drums.map((d) => d.drumId).reverse();
    host.setKitOutputs([
      {
        id: 'out0',
        channelsPerPixel: 3,
        segments: reversed.map((drumId) => ({
          drumId,
          hoopStart: 1, // hoops are 1-based (A1)
          hoopEnd: model.drumById.get(drumId)!.hoopCount,
        })),
      },
    ]);

    const after = host.getDmxMap().universes[0]!.pixels[0]!.id;
    expect(after).toBe(model.drumById.get(reversed[0]!)!.pixelStart);
    expect(after).not.toBe(before);
  });

  it('reconciles setKitOutputs to the canonical port count for the current mode (undo-drift backstop)', () => {
    // N1 defense-in-depth / N3: setKitOutputs is the 4th path writing kit.outputs and carries no
    // `expanded`. An undo resync could re-apply a 4-output topology while the live kit is still
    // expanded (8 ports) — the host must clamp/grow to logicalOutputCount rather than pin at 4.
    const { host } = makeHost(voice.createNullEngine());
    host.setKitGlobal({ expanded: true }); // 8-port mode live
    host.setKitOutputs([{ id: 'output:1', channelsPerPixel: 3, segments: [] }]); // stale 1-output set
    const outputs = host.getProject().kit.outputs;
    expect(outputs).toHaveLength(8);
    expect(new Set(outputs.map((o) => o.id)).size).toBe(8); // unique ids after the grow
  });

  // --- S07: routing degradation is reported, not silent ---
  /** A schema-typed output topology whose segment references a drum the kit lacks — buildDmxMap
   * throws on it, so buildMapSafe must degrade to a flat map AND name the offending reference. */
  const danglingOutputs = [
    { id: 'out0', channelsPerPixel: 3, segments: [{ drumId: 'ghost', hoopStart: 0, hoopEnd: 0 }] },
  ];

  it('reports a routing degradation as a named Monitor error before falling back to a flat map', () => {
    const { host } = makeHost(voice.createNullEngine());
    const events: unknown[] = [];
    host.setMonitor((event) => events.push(event));

    // A corrupt topology set live: buildDmxMap throws → buildMapSafe degrades, now loudly.
    host.setKitOutputs(danglingOutputs);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        direction: 'local',
        source: 'server/voice',
        destination: 'routing',
        label: 'Routing topology invalid — degraded to flat map',
        detail: expect.stringContaining('unknown drum "ghost"'),
      }),
    );
    // Still usable: the flat fallback patches every pixel exactly once.
    expect(host.getDmxMap().perPixel.filter(Boolean)).toHaveLength(host.getModel().pixelCount);
  });

  it('buffers a construction-time degradation and flushes it when a monitor connects (boot path)', () => {
    // A persisted project whose kit carries a corrupt topology degrades in the constructor —
    // before any monitor sink exists. The diagnostic must survive until setMonitor wires one.
    const p = defaultProject();
    p.kit.outputs = danglingOutputs;
    const host = new VoiceEngineHost(p);

    const events: unknown[] = [];
    host.setMonitor((event) => events.push(event)); // connects AFTER construction

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        destination: 'routing',
        detail: expect.stringContaining('unknown drum "ghost"'),
      }),
    );
  });

  it('does not report a degradation when routing is valid, and clears a prior one on recovery', () => {
    const { host } = makeHost(voice.createNullEngine());
    const events: unknown[] = [];
    host.setMonitor((event) => events.push(event));

    // Valid outputs → no degradation event.
    const model = host.getModel();
    const validOutputs = [
      {
        id: 'out0',
        channelsPerPixel: 3,
        segments: model.drums.map((d) => ({ drumId: d.drumId, hoopStart: 1, hoopEnd: d.hoopCount })), // 1-based (A1)
      },
    ];
    host.setKitOutputs(validOutputs);
    expect(events.filter((e) => (e as { destination?: string }).destination === 'routing')).toHaveLength(0);

    // Degrade, then recover — a second valid set must not re-emit the stale diagnostic.
    host.setKitOutputs(danglingOutputs);
    host.setKitOutputs(validOutputs);
    expect(events.filter((e) => (e as { destination?: string }).destination === 'routing')).toHaveLength(1);
  });

  // --- U3: trigger-source routing (zone-map + direct Cue bindings) ---
  // defaultProject maps note 36 → kick/center and OSC /sp/* → pads, so anything else is
  // "unmapped" and reaches only a Cue bound to it. The voices' `pad` tells us which Effect fired.
  const firedEffects = (host: VoiceEngineHost): string[] =>
    host.getStats().engine.voices.map((v) => v.pad).sort();

  it('a raw unmapped MIDI note fires the Cue bound to it', () => {
    const { host } = makeHost();
    host.setShow(showOf(cueFlash('direct', { midiNote: 60 })));
    host.applyInput({ kind: 'noteOn', note: 60, velocity: 1 }); // 60 is unmapped → the Cue only
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(firedEffects(host)).toEqual(['effect:direct']);
  });

  it('a zone-mapped MIDI note can still fire a Cue bound directly to that note', () => {
    const { host } = makeHost();
    host.setShow(showOf(cueFlash('direct', { midiNote: 36 })));
    host.applyInput({ kind: 'noteOn', note: 36, velocity: 1 }); // 36 is mapped to kick/center, but the Cue still receives it.
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(firedEffects(host)).toEqual(['effect:direct']);
  });

  it('a zone-mapped note fires both its zone Effect and a same-note Cue', () => {
    const { host } = makeHost();
    host.setShow(showOf(flash('pad', { cell: { row: 'kick', column: { kind: 'zone', slot: 0 } } }), cueFlash('direct', { midiNote: 36 })));
    // note 36 → kick/center via the zone-map, while a Cue can also opt into the raw note.
    host.applyInput({ kind: 'noteOn', note: 36, velocity: 1 });
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(firedEffects(host)).toEqual(['effect:direct', 'effect:pad']);
  });

  it('a raw unmapped OSC address fires the Cue bound to it', () => {
    const { host } = makeHost();
    host.setShow(showOf(cueFlash('direct', { oscAddress: '/fx/strobe' })));
    host.applyInput({ kind: 'osc', address: '/fx/strobe', value: 1 }); // unmapped address → the Cue
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(firedEffects(host)).toEqual(['effect:direct']);
  });

  it('retains the show + tracks the active song for global transport recall', () => {
    const { host } = makeHost(voice.createNullEngine());
    const show: voice.Show = {
      songs: [
        { id: 'songA', name: 'A', sections: [{ id: 'a0', name: 'A0', effects: [] }] },
        { id: 'songB', name: 'B', sections: [{ id: 'b0', name: 'B0', effects: [] }] },
      ],
    };
    host.setShow(show);
    // setShow retains the show + seeds the active song from the first entry.
    expect(host.getShow()).toBe(show);
    expect(host.getActiveSongId()).toBe('songA');

    // A queued recall must not update the host mirror ahead of the engine. The live handler now
    // queues the index intent and the engine diagnostic is the acknowledgement path.
    host.applyInput({ kind: 'recallSection', songId: 'songB', sectionId: 'b0' });
    expect(host.getActiveSongId()).toBe('songA');

    // A sectionId-only recall also leaves the engine-confirmed song unchanged until processing.
    host.applyInput({ kind: 'recallSection', sectionId: 'b0' });
    expect(host.getActiveSongId()).toBe('songA');
  });

  it('setKitTransform with pixelsPerHoop changes the live model pixel count', () => {
    const { host } = makeHost(voice.createNullEngine());
    const before = host.getModel().pixelCount;
    const kick = host.getModel().drumById.get('kick')!;
    const target = kick.pixelsPerHoop + 10;

    host.setKitTransform('kick', { pixelsPerHoop: target });

    const after = host.getModel().drumById.get('kick')!;
    expect(after.pixelsPerHoop).toBe(target);
    // 4-hoop kick → +10 px/hoop adds exactly 40 pixels to the whole model.
    expect(host.getModel().pixelCount).toBe(before + 10 * after.hoopCount);
  });

  it('setHoopConfig changes ONE hoop\'s pixel count on the live model (B4 per-hoop, 1-based)', () => {
    const { host } = makeHost(voice.createNullEngine());
    const before = host.getModel().pixelCount;
    const kick = host.getProject().kit.drums.find((d) => d.id === 'kick')!;
    const target = kick.hoops![0]!.pixelCount + 12;

    host.setHoopConfig('kick', 1, { pixelCount: target, reverse: true });

    const hoop0 = host.getProject().kit.drums.find((d) => d.id === 'kick')!.hoops![0]!;
    expect(hoop0).toMatchObject({ pixelCount: target, reverse: true });
    // Only hoop 1 grew → the whole model gains exactly the +12 delta (siblings unchanged).
    expect(host.getModel().pixelCount).toBe(before + 12);
  });

  it('setHoopConfig no-ops for an unknown drum / out-of-range hoop (never throws)', () => {
    const { host } = makeHost(voice.createNullEngine());
    const before = host.getModel().pixelCount;
    host.setHoopConfig('nope', 1, { pixelCount: 999 });
    host.setHoopConfig('kick', 999, { pixelCount: 999 });
    expect(host.getModel().pixelCount).toBe(before);
  });

  it('SF1: setHoopConfig MATERIALIZES hoops[] on a density-resolved drum (server parity w/ engine + client)', () => {
    // Make `kick` density-derived: strip its literal pixelsPerHoop AND hoops[] so it resolves via
    // density — the reachable dead-control shape the C5 hoop inspector wrote to as a no-op pre-SF1.
    const fake = new FakeOutput();
    const project = defaultProject();
    const kick = project.kit.drums.find((d) => d.id === 'kick')!;
    delete (kick as { pixelsPerHoop?: number }).pixelsPerHoop;
    delete (kick as { hoops?: unknown }).hoops;
    const host = new VoiceEngineHost(project, voice.createNullEngine(), new OutputManager(() => fake));

    expect(host.getProject().kit.drums.find((d) => d.id === 'kick')!.hoops).toBeUndefined();
    const resolved = host.getModel().drumById.get('kick')!.pixelsPerHoop; // density-resolved count
    const before = host.getModel().pixelCount;

    host.setHoopConfig('kick', 2, { pixelCount: resolved + 7, reverse: true });

    const after = host.getProject().kit.drums.find((d) => d.id === 'kick')!;
    expect(after.hoops).toHaveLength(4); // global hoopCount → materialized identically to engine/client
    expect(after.hoops![0]).toMatchObject({ pixelCount: resolved, reverse: false }); // sibling untouched
    expect(after.hoops![1]).toMatchObject({ pixelCount: resolved + 7, reverse: true }); // hoop 2 (1-based)
    expect(host.getModel().pixelCount).toBe(before + 7); // only hoop 2 grew
  });

  it('emits an unrouted-input monitor event for a note bound to no zone or Cue', () => {
    const { host } = makeHost();
    const events: unknown[] = [];
    host.setMonitor((event) => events.push(event));
    host.setShow(makeShow('kick', '0'));

    // note 7 is in no zone-map entry and no Cue source → genuinely unrouted
    host.applyInput({ kind: 'noteOn', note: 7, velocity: 1 });
    for (let i = 0; i < 4; i++) host.step(STEP);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'graph',
        direction: 'local',
        source: 'server/voice',
        label: 'Unrouted input',
        detail: expect.stringContaining('matched no zone or Cue'),
      }),
    );
  });

  it.each(['__proto__', 'constructor', 'toString'])('fires nothing for an inherited-property Effect id %s', (effectId) => {
    const { host } = makeHost();
    host.setShow(makeShow('kick', '0'));

    expect(() => {
      host.applyInput({ kind: 'fireEffect', effectId, velocity: 1 });
      for (let i = 0; i < 4; i++) host.step(STEP);
    }).not.toThrow();
    expect(host.getStats().engine.voiceCount).toBe(0);
  });
});

describe('VoiceEngineHost — MIDI clock transport', () => {
  const PULSE_120 = 60_000 / (120 * 24);

  /** A host with an injected receipt clock and the transport switched to the external clock. */
  function clockHost(clockInput: 'native' | 'browser' = 'native') {
    const made = makeHost();
    let now = 0;
    made.host.clockNow = () => now;
    made.project.composition.transport.source = 'midiClock';
    made.project.composition.transport.clockInput = clockInput;
    made.project.composition.transport.bpm = 100;
    const at = (ms: number): void => {
      now = ms;
    };
    /** Advance both the receipt clock and the engine by `ms` in engine steps. */
    const run = (ms: number): void => {
      const steps = Math.round(ms / STEP);
      for (let i = 0; i < steps; i++) {
        now += STEP;
        made.host.step(STEP);
      }
    };
    return { ...made, at, run };
  }

  it('ignores every clock message while the transport source is manual', () => {
    const { host, project } = makeHost();
    expect(host.applyMidiClock({ command: 'start' }, 'native')).toBe(false);
    for (let i = 0; i < 48; i++) expect(host.applyMidiClock({ command: 'tick' }, 'native')).toBe(false);
    host.step(STEP);
    expect(host.getClockStatus()).toEqual({ status: 'off', bpm: project.composition.transport.bpm, locked: false, playing: false });
    expect(host.getStats().engine.beat).toBeGreaterThan(0); // the manual transport kept running
  });

  it('accepts only the selected route, so browser and native clocks can never combine', () => {
    const { host } = clockHost('native');
    expect(host.applyMidiClock({ command: 'start' }, 'browser')).toBe(false);
    expect(host.getClockStatus().status).toBe('waiting');
    expect(host.applyMidiClock({ command: 'start' }, 'native')).toBe(true);
    expect(host.getClockStatus().status).toBe('running');
  });

  it('drives beat, bpm and playing from a synthetic 24 PPQN stream stamped with the receipt clock', () => {
    const { host, at, run } = clockHost();
    // Before any pulse: waiting, seeded from the authored bpm, not locked, not playing.
    run(STEP);
    expect(host.getClockStatus()).toEqual({ status: 'waiting', bpm: 100, locked: false, playing: false });
    expect(host.getStats().engine.beat).toBe(0);

    at(1000);
    host.applyMidiClock({ command: 'start' }, 'native');
    for (let i = 0; i <= 96; i++) {
      at(1000 + i * PULSE_120);
      host.applyMidiClock({ command: 'tick' }, 'native');
    }
    run(STEP);
    const status = host.getClockStatus();
    expect(status.status).toBe('running');
    expect(status.playing).toBe(true);
    expect(status.locked).toBe(true);
    expect(status.bpm).toBeCloseTo(120, 3);
    // 96 pulses after the anchoring one = exactly 4 beats, plus one engine step of interpolation.
    expect(host.getStats().engine.beat).toBeGreaterThanOrEqual(4);
    expect(host.getStats().engine.beat).toBeLessThan(4 + 1 / 24);
  });

  it('goes lost after a second of silence, freezes the beat and stops, then resumes on the next pulse', () => {
    const { host, at, run } = clockHost();
    at(0);
    host.applyMidiClock({ command: 'start' }, 'native');
    for (let i = 0; i <= 48; i++) {
      at(i * PULSE_120);
      host.applyMidiClock({ command: 'tick' }, 'native');
    }
    run(STEP);
    const beatBefore = host.getStats().engine.beat;
    run(1200);
    expect(host.getClockStatus().status).toBe('lost');
    expect(host.getClockStatus().playing).toBe(false);
    expect(host.getClockStatus().bpm).toBeCloseTo(120, 3); // retained for display
    expect(host.getStats().engine.beat).toBeCloseTo(beatBefore, 1); // frozen (≤ one pulse), no catch-up
    host.applyMidiClock({ command: 'tick' }, 'native');
    run(STEP);
    expect(host.getClockStatus().status).toBe('running');
    expect(host.getClockStatus().playing).toBe(true);
  });

  it('logs clock status transitions to the Monitor, never pulses', () => {
    const { host, at, run } = clockHost();
    const events: Array<{ label: string }> = [];
    host.setMonitor((e) => events.push(e as { label: string }));
    run(STEP);
    at(0);
    host.applyMidiClock({ command: 'start' }, 'native');
    for (let i = 0; i < 200; i++) {
      at(i * PULSE_120);
      host.applyMidiClock({ command: 'tick' }, 'native');
      run(STEP);
    }
    host.applyMidiClock({ command: 'stop' }, 'native');
    run(STEP);
    const clockLabels = events.map((e) => e.label).filter((l) => l.startsWith('MIDI clock'));
    expect(clockLabels).toEqual(['MIDI clock waiting', 'MIDI clock running', 'MIDI clock stopped']);
  });

  it('switching the source back to manual resumes the authored transport and reports off', () => {
    const { host, project, at, run } = clockHost();
    at(0);
    host.applyMidiClock({ command: 'start' }, 'native');
    run(STEP);
    project.composition.transport.source = 'manual';
    run(STEP);
    expect(host.getClockStatus().status).toBe('off');
    expect(host.applyMidiClock({ command: 'tick' }, 'native')).toBe(false);
  });
});
