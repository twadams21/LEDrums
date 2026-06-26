import { describe, expect, it } from 'vitest';
import { SLOT_LABELS, defaultProject, voice } from '@ledrums/core';
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

/**
 * A minimal Show: one `flash` effect on a poly bus, scoped to the whole kit, fired by
 * the trigger graph registered for the `kick:center` pad. attackMs=0 so the voice
 * reaches full level on the first tick; brightness=1 so the compositor emits light.
 */
function makeShow(drumId: string, zone: string): voice.Show {
  const effect: voice.EffectDef = {
    id: 'fx-flash',
    name: 'Flash',
    pattern: 'flash',
    busId: 'main',
    scope: 'kit',
    params: [
      { key: 'hue', label: 'Hue', kind: 'number', min: 0, max: 360, default: 60 },
      { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 },
    ],
    attackMs: 0,
    sustainMs: 200,
    releaseMs: 200,
  };
  const node = (id: string, kind: voice.NodeKind, extra: Partial<voice.GraphNode> = {}): voice.GraphNode => ({
    id,
    kind,
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    linked: false,
    noRepeat: false,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 1,
    ...extra,
    // `extra` is a Partial, so spreading it widens required keys (e.g. valueMode) to
    // `| undefined`; the literal is structurally complete, so re-assert the full type.
  } as voice.GraphNode);
  const graph: voice.TriggerGraph = {
    nodes: [
      node('trig', 'trigger'),
      node('play', 'play', { effectId: 'fx-flash', params: { hue: 60, brightness: 1 } }),
    ],
    edges: [{ id: 'e1', from: 'trig', to: 'play' }],
  };
  return {
    buses: [{ id: 'main', name: 'Main', polyphony: 'poly', crossfadeMs: 200 }],
    graphs: { [voice.padKey(drumId, zone)]: graph },
    sections: [],
    effects: [effect],
    presets: [],
  };
}

function makeHost(engine?: voice.RenderEngine) {
  const fake = new FakeOutput();
  const project = defaultProject();
  project.output.state = 'armed';
  project.output.fps = 60;
  const host = new VoiceEngineHost(project, engine ?? voice.createVoiceBusEngine(), new OutputManager(() => fake));
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
  it('starts black, then lights up after a key hit fires its graph', () => {
    const { host } = makeHost();
    host.setShow(makeShow('kick', SLOT_LABELS[0]));

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
    host.applyInput({ kind: 'key', drumId: 'kick', zone: SLOT_LABELS[0], velocity: 1 });
    for (let i = 0; i < 8; i++) host.step(STEP);

    expect(host.getStats().engine.voiceCount).toBeGreaterThan(0);
    expect(frameMax(last!)).toBeGreaterThan(0);
  });

  it('resolves a mapped MIDI note to its drum via the project inputMap', () => {
    const { host, project } = makeHost();
    // defaultProject maps note 36 → kick/slot 0 (zone 'center').
    const map = project.inputMap.midiNotes.find((m) => m.note === 36)!;
    expect(map.drumId).toBe('kick');
    host.setShow(makeShow('kick', SLOT_LABELS[map.slot] ?? SLOT_LABELS[0]));

    host.applyInput({ kind: 'noteOn', note: 36, velocity: 1 });
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(host.getStats().engine.voiceCount).toBeGreaterThan(0);
  });

  it('an unmapped MIDI note fires nothing (no voice) and does not throw', () => {
    const { host } = makeHost();
    host.setShow(makeShow('kick', SLOT_LABELS[0]));
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
    host.setShow(makeShow('kick', SLOT_LABELS[0]));
    host.applyInput({ kind: 'key', drumId: 'kick', zone: SLOT_LABELS[0], velocity: 1 });
    for (let i = 0; i < 4; i++) host.step(STEP);
    const stats = host.getStats();
    expect(stats.engine.voiceCount).toBeGreaterThan(0);
    expect(stats.engine.busLevels).toHaveProperty('main');
    expect(stats.engine.busLevels.main).toBeGreaterThan(0);
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
        dataLines: [
          {
            id: 'out0:dl0',
            segments: reversed.map((drumId) => ({
              drumId,
              hoopStart: 0,
              hoopEnd: model.drumById.get(drumId)!.hoopCount - 1,
            })),
          },
        ],
      },
    ]);

    const after = host.getDmxMap().universes[0]!.pixels[0]!.id;
    expect(after).toBe(model.drumById.get(reversed[0]!)!.pixelStart);
    expect(after).not.toBe(before);
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
});
