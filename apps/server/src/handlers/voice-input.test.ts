import { describe, expect, it } from 'vitest';
import { defaultProject, voice } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import type { ServerMessage } from '@ledrums/protocol';
import { OutputManager } from '../output-manager';
import { VoiceEngineHost } from '../voice-engine-host';
import { handleVoiceInput, type VoiceInputDeps } from './voice-input';

/* S12 — the server is the sole authoritative resolver when a client is connected. This asserts
   the count that the authority principle promises: ONE MIDI hit produces exactly ONE input echo
   broadcast and exactly ONE graph-fired diagnostic per resolved graph — no re-fire, no duplicate
   broadcast. (The old duplicate fires were client-side echo, not the server; this locks the
   server end down so later E slices can rely on it.) */

class FakeOutput implements PixelOutput {
  nextFrame(): void {}
  send(): void {}
  close(): void {}
}

const node = (id: string, kind: voice.NodeKind, extra: Partial<voice.GraphNode> = {}): voice.GraphNode =>
  ({
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, noRepeat: false, on: 'value', valueMode: 'gate',
    threshold: 0.5, invert: false, bands: [0.5], p: 1, delayMode: 'time', ms: 0, division: '1/8',
    ...extra,
  }) as voice.GraphNode;

/** One graph bound DIRECTLY to a raw MIDI note (no zone-map), playing a kit-wide flash on the
    `main` bus. An unmapped note therefore resolves exactly one graph. */
function directNoteShow(note: number): voice.Show {
  const flash: voice.EffectDef = {
    id: 'fx-flash', name: 'Flash', generatorId: 'whole-drum', busId: 'main', scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 0, sustainMs: 200, releaseMs: 200,
  };
  const graph: voice.TriggerGraph = {
    nodes: [
      node('trig', 'trigger', { source: { kind: 'midi', note } }),
      node('play', 'play', { effectId: 'fx-flash', busId: 'main', params: { brightness: 1 } }),
    ],
    edges: [{ id: 'e1', from: 'trig', to: 'play' }],
  };
  return {
    buses: [{ id: 'main', name: 'Main', polyphony: 'poly', crossfadeMs: 200 }],
    graphs: { 'graph:1': graph },
    sections: [],
    effects: [flash],
    presets: [],
  };
}

function makeHost(): VoiceEngineHost {
  return new VoiceEngineHost(defaultProject(), null, new OutputManager(() => new FakeOutput()));
}

describe('handleVoiceInput — one connected MIDI hit fires once (S12)', () => {
  it('a single MIDI note broadcasts exactly one input echo and fires exactly one graph', () => {
    const host = makeHost();
    host.setShow(directNoteShow(60)); // note 60 is unmapped in defaultProject → direct binding only

    const monitorEvents: Array<{ label?: string }> = [];
    host.setMonitor((e) => monitorEvents.push(e as { label?: string }));

    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };

    const handled = handleVoiceInput({ t: 'midi', note: 60, velocity: 127, on: true, channel: 0 }, deps);
    for (let i = 0; i < 4; i++) host.step(1000 / 120); // let the voice reach level

    expect(handled).toBe(true);

    // Exactly one `input` broadcast (the monitor "input" line), carrying this note.
    const inputBroadcasts = broadcasts.filter((m) => m.t === 'input');
    expect(inputBroadcasts).toHaveLength(1);
    expect(inputBroadcasts[0]).toMatchObject({ t: 'input', kind: 'midi', note: 60 });

    // Exactly one graph-fired diagnostic — one authoritative fire, no re-fire.
    const graphFired = monitorEvents.filter((e) => e.label?.startsWith('Graph fired'));
    expect(graphFired).toHaveLength(1);

    // And exactly one bus is lit by that single fire.
    const litBuses = Object.values(host.getStats().engine.busLevels).filter((l) => l > 0);
    expect(litBuses).toHaveLength(1);
  });

  it('the note-off for the same hit adds no extra graph fire', () => {
    const host = makeHost();
    host.setShow(directNoteShow(60));

    const monitorEvents: Array<{ label?: string }> = [];
    host.setMonitor((e) => monitorEvents.push(e as { label?: string }));
    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };

    handleVoiceInput({ t: 'midi', note: 60, velocity: 127, on: true, channel: 0 }, deps);
    handleVoiceInput({ t: 'midi', note: 60, velocity: 0, on: false, channel: 0 }, deps);
    for (let i = 0; i < 4; i++) host.step(1000 / 120);

    // Note-on + note-off each echo once; only the note-on fires a graph.
    expect(broadcasts.filter((m) => m.t === 'input')).toHaveLength(2);
    expect(monitorEvents.filter((e) => e.label?.startsWith('Graph fired'))).toHaveLength(1);
  });
});

/* S13 — the keyboard performance path sends a `fireGraph` INTENT (the exact graph key) instead
   of a synthetic MIDI/OSC source. The server plays precisely that graph — once — with no
   re-resolution (so no zone-map / direct-binding both-fire), and validates the key: an unknown
   key fires nothing and surfaces the normal graph-missed diagnostic. */
describe('handleVoiceInput — fireGraph intent fires the exact graph once (S13)', () => {
  it('fires exactly the named graph, once, and lights only its bus', () => {
    const host = makeHost();
    host.setShow(directNoteShow(60)); // graph:1 → flash on the `main` bus

    const monitorEvents: Array<{ label?: string }> = [];
    host.setMonitor((e) => monitorEvents.push(e as { label?: string }));
    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };

    const handled = handleVoiceInput({ t: 'fireGraph', graphKey: 'graph:1', velocity: 1 }, deps);
    for (let i = 0; i < 4; i++) host.step(1000 / 120);

    expect(handled).toBe(true);

    // Exactly one graph-fired diagnostic, for the exact key — one authoritative fire, no re-fire.
    const graphFired = monitorEvents.filter((e) => e.label?.startsWith('Graph fired'));
    expect(graphFired).toHaveLength(1);
    expect(graphFired[0]?.label).toBe('Graph fired graph:1');

    // Exactly one bus lit by that single fire.
    const litBuses = Object.values(host.getStats().engine.busLevels).filter((l) => l > 0);
    expect(litBuses).toHaveLength(1);

    // No `input` echo broadcast — the fire is surfaced by the graph diagnostics, not a note echo.
    expect(broadcasts.filter((m) => m.t === 'input')).toHaveLength(0);
  });

  it('validates the key — an unknown graph key fires nothing and reports a miss', () => {
    const host = makeHost();
    host.setShow(directNoteShow(60));

    const monitorEvents: Array<{ label?: string }> = [];
    host.setMonitor((e) => monitorEvents.push(e as { label?: string }));
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: () => {} };

    const handled = handleVoiceInput({ t: 'fireGraph', graphKey: 'graph:does-not-exist', velocity: 1 }, deps);
    for (let i = 0; i < 4; i++) host.step(1000 / 120);

    expect(handled).toBe(true);
    expect(monitorEvents.filter((e) => e.label?.startsWith('Graph fired'))).toHaveLength(0);
    expect(monitorEvents.filter((e) => e.label === 'No graph resolved')).toHaveLength(1);
    expect(Object.values(host.getStats().engine.busLevels).filter((l) => l > 0)).toHaveLength(0);
  });
});

/* releaseBus — the dock's per-bus stop button finally reaches the live engine: the message
   rides the deterministic input queue like every other performance input. */
describe('handleVoiceInput — releaseBus routes to the engine input queue', () => {
  it('maps the message to a releaseBus input (bus-scoped and all-buses)', () => {
    const applied: unknown[] = [];
    const deps: VoiceInputDeps = {
      voiceHost: { applyInput: (e: unknown) => applied.push(e) } as never,
      broadcastJson: () => {},
    };
    expect(handleVoiceInput({ t: 'releaseBus', busId: 'lead' }, deps)).toBe(true);
    expect(handleVoiceInput({ t: 'releaseBus' }, deps)).toBe(true);
    expect(applied).toEqual([
      { kind: 'releaseBus', busId: 'lead' },
      { kind: 'releaseBus', busId: undefined },
    ]);
  });

  it('is consumed as a no-op in legacy mode (no voice host)', () => {
    expect(handleVoiceInput({ t: 'releaseBus' }, { voiceHost: null, broadcastJson: () => {} })).toBe(true);
  });
});

/* S8 — the input echo carries the drum the zone-map claimed, so a per-drum velocity editor can
   plot the hit under the right curve. Resolved here rather than parsed back out of the label,
   and always the PRE-curve value: echoing the shaped one would draw the hits on top of the
   curve instead of under it. */
describe('handleVoiceInput — the input echo names the drum', () => {
  const echoes = (msgs: ServerMessage[]): Array<Extract<ServerMessage, { t: 'input' }>> =>
    msgs.filter((m): m is Extract<ServerMessage, { t: 'input' }> => m.t === 'input');

  it('attaches the zone-mapped drum to a MIDI hit, with the raw 0..1 velocity', () => {
    const host = makeHost();
    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };
    // defaultProject maps note 36 → kick.
    handleVoiceInput({ t: 'midi', note: 36, velocity: 64, on: true, channel: 0 }, deps);

    expect(echoes(broadcasts)).toHaveLength(1);
    expect(echoes(broadcasts)[0]!.drumId).toBe('kick');
    expect(echoes(broadcasts)[0]!.value).toBeCloseTo(64 / 127, 6);
  });

  it('leaves the drum off an unclaimed note', () => {
    const host = makeHost();
    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };
    handleVoiceInput({ t: 'midi', note: 99, velocity: 64, on: true, channel: 0 }, deps);

    expect(echoes(broadcasts)[0]!.drumId).toBeUndefined();
  });

  it('names the drum a pad hit already carries', () => {
    const host = makeHost();
    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };
    handleVoiceInput({ t: 'key', drumId: 'snare', zone: '0', velocity: 0.7 }, deps);

    expect(echoes(broadcasts)[0]!.drumId).toBe('snare');
    expect(echoes(broadcasts)[0]!.value).toBe(0.7);
  });

  it('attaches the drum a zone-mapped OSC address belongs to', () => {
    const host = makeHost();
    const project = defaultProject();
    host.setInputMap({ ...project.inputMap, oscMap: [{ address: '/sp/kick', drumId: 'kick', slot: 0 }] });
    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };
    handleVoiceInput({ t: 'osc', address: '/sp/kick', value: 0.9 }, deps);

    expect(echoes(broadcasts)[0]!.drumId).toBe('kick');
    handleVoiceInput({ t: 'osc', address: '/unclaimed', value: 0.9 }, deps);
    expect(echoes(broadcasts)[1]!.drumId).toBeUndefined();
  });
});
