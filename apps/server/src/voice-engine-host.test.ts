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

  // --- U3: trigger-source routing (zone-map precedence + direct bindings) ---
  // A play-on-`busId` graph whose trigger carries `source`; the bus that lights tells us
  // which graph fired. defaultProject maps note 36 → kick/center and OSC /sp/* → pads, so
  // anything else is "unmapped" and falls through to a direct trigger-source binding.
  const trigNode = (source?: voice.TriggerSource): voice.GraphNode =>
    ({
      id: 'trig', kind: 'trigger', x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '',
      presetId: '', busId: '', params: {}, env: {}, linked: false, noRepeat: false, on: 'value',
      valueMode: 'gate', threshold: 0.5, invert: false, bands: [0.5], p: 1,
      delayMode: 'time', ms: 0, division: '1/8', source,
    }) as voice.GraphNode;

  const playNode = (busId: string): voice.GraphNode =>
    ({
      id: 'play', kind: 'play', x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: 'fx-flash',
      presetId: '', busId, params: { hue: 60, brightness: 1 }, env: {}, linked: false,
      noRepeat: false, on: 'value', valueMode: 'gate', threshold: 0.5, invert: false, bands: [0.5], p: 1,
      delayMode: 'time', ms: 0, division: '1/8',
    }) as voice.GraphNode;

  const trigGraph = (source: voice.TriggerSource | undefined, busId: string): voice.TriggerGraph => ({
    nodes: [trigNode(source), playNode(busId)],
    edges: [{ id: 'e1', from: 'trig', to: 'play' }],
  });

  /** A show from explicit graphs, with a poly bus per id the plays land on. */
  const routingShow = (graphs: Record<string, voice.TriggerGraph>, busIds: string[]): voice.Show => ({
    buses: busIds.map((id) => ({ id, name: id, polyphony: 'poly' as const, crossfadeMs: 200 })),
    graphs,
    sections: [],
    effects: [
      {
        id: 'fx-flash', name: 'Flash', pattern: 'flash', busId: busIds[0] ?? 'main', scope: 'kit',
        params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
        attackMs: 0, sustainMs: 200, releaseMs: 200,
      },
    ],
    presets: [],
  });

  const litBuses = (host: VoiceEngineHost): string[] => {
    const { busLevels } = host.getStats().engine;
    return Object.keys(busLevels)
      .filter((b) => (busLevels[b] ?? 0) > 0)
      .sort();
  };

  it('a raw unmapped MIDI note fires the authored graph bound to its midi source', () => {
    const { host } = makeHost();
    host.setShow(routingShow({ 'graph:1': trigGraph({ kind: 'midi', note: 60 }, 'direct') }, ['direct']));
    host.applyInput({ kind: 'noteOn', note: 60, velocity: 1 }); // 60 is unmapped → direct binding
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(litBuses(host)).toEqual(['direct']);
  });

  it('a zone-mapped MIDI note can still fire an authored graph bound directly to that note', () => {
    const { host } = makeHost();
    host.setShow(routingShow({ 'graph:1': trigGraph({ kind: 'midi', note: 36 }, 'direct') }, ['direct']));
    host.applyInput({ kind: 'noteOn', note: 36, velocity: 1 }); // 36 is mapped to kick/center, but direct binding still receives it.
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(litBuses(host)).toEqual(['direct']);
  });

  it('a zone-mapped note fires both its pad graph and a same-note direct binding', () => {
    const { host } = makeHost();
    host.setShow(
      routingShow(
        {
          [voice.padKey('kick', SLOT_LABELS[0])]: trigGraph({ kind: 'drum', drumId: 'kick', zone: SLOT_LABELS[0] }, 'pad'),
          'graph:1': trigGraph({ kind: 'midi', note: 36 }, 'direct'),
        },
        ['pad', 'direct'],
      ),
    );
    // note 36 → kick/center via the zone-map, while a graph can also opt into the raw
    // note as its own trigger source.
    host.applyInput({ kind: 'noteOn', note: 36, velocity: 1 });
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(litBuses(host)).toEqual(['direct', 'pad']);
  });

  it('a raw unmapped OSC address fires the authored graph bound to its osc source', () => {
    const { host } = makeHost();
    host.setShow(routingShow({ 'graph:1': trigGraph({ kind: 'osc', address: '/fx/strobe' }, 'direct') }, ['direct']));
    host.applyInput({ kind: 'osc', address: '/fx/strobe', value: 1 }); // unmapped address → direct
    for (let i = 0; i < 8; i++) host.step(STEP);
    expect(litBuses(host)).toEqual(['direct']);
  });

  it('retains the show + tracks the active song for global transport recall', () => {
    const { host } = makeHost(voice.createNullEngine());
    const show: voice.Show = {
      ...routingShow({}, ['main']),
      songs: [
        { id: 'songA', name: 'A', sections: [{ id: 'a0', name: 'A0', slots: {} }] },
        { id: 'songB', name: 'B', sections: [{ id: 'b0', name: 'B0', slots: {} }] },
      ],
    };
    host.setShow(show);
    // setShow retains the show + seeds the active song from the first entry.
    expect(host.getShow()).toBe(show);
    expect(host.getActiveSongId()).toBe('songA');

    // A recall that names a song (UI- or transport-driven) updates the active song, so a
    // subsequent CC#0 section recall resolves against it.
    host.applyInput({ kind: 'recallSection', songId: 'songB', sectionId: 'b0' });
    expect(host.getActiveSongId()).toBe('songB');

    // A sectionId-only recall leaves the active song unchanged.
    host.applyInput({ kind: 'recallSection', sectionId: 'b0' });
    expect(host.getActiveSongId()).toBe('songB');
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

  it('emits server-authoritative graph monitor events for fired graphs', () => {
    const { host } = makeHost();
    const events: unknown[] = [];
    host.setMonitor((event) => events.push(event));
    host.setShow(makeShow('kick', SLOT_LABELS[0]));

    host.applyInput({ kind: 'key', drumId: 'kick', zone: SLOT_LABELS[0], velocity: 1 });
    for (let i = 0; i < 4; i++) host.step(STEP);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'graph',
        direction: 'local',
        source: 'server/voice',
        destination: `graph:${voice.padKey('kick', SLOT_LABELS[0])}`,
        label: `Graph fired ${voice.padKey('kick', SLOT_LABELS[0])}`,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        detail: expect.stringContaining('path=pad-fallback'),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        detail: expect.stringContaining('effects=Flash (fx-flash)'),
      }),
    );
  });

  it('emits an unrouted-input monitor event for a note bound to no zone or graph', () => {
    const { host } = makeHost();
    const events: unknown[] = [];
    host.setMonitor((event) => events.push(event));
    host.setShow(makeShow('kick', SLOT_LABELS[0]));

    // note 7 is in no zone-map entry and no graph source → genuinely unrouted
    host.applyInput({ kind: 'noteOn', note: 7, velocity: 1 });
    for (let i = 0; i < 4; i++) host.step(STEP);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'graph',
        direction: 'local',
        source: 'server/voice',
        label: 'Unrouted input',
        detail: expect.stringContaining('matched no zone or graph'),
      }),
    );
  });

  it('emits a graph-miss monitor event for a routed pad hit with no resolved graph', () => {
    const { host } = makeHost();
    const events: unknown[] = [];
    host.setMonitor((event) => events.push(event));
    // A show whose only graph is for a DIFFERENT drum, so a snare pad hit routes but resolves nothing.
    host.setShow(makeShow('kick', SLOT_LABELS[0]));

    host.applyInput({ kind: 'key', drumId: 'snare', zone: SLOT_LABELS[0], velocity: 1 });
    for (let i = 0; i < 4; i++) host.step(STEP);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'graph',
        direction: 'local',
        source: 'server/voice',
        label: 'No graph resolved',
        detail: expect.stringContaining('reason='),
      }),
    );
  });
});
