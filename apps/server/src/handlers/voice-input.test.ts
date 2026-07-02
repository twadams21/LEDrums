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
    params: {}, env: {}, linked: false, noRepeat: false, on: 'value', valueMode: 'gate',
    threshold: 0.5, invert: false, bands: [0.5], p: 1, delayMode: 'time', ms: 0, division: '1/8',
    ...extra,
  }) as voice.GraphNode;

/** One graph bound DIRECTLY to a raw MIDI note (no zone-map), playing a kit-wide flash on the
    `main` bus. An unmapped note therefore resolves exactly one graph. */
function directNoteShow(note: number): voice.Show {
  const flash: voice.EffectDef = {
    id: 'fx-flash', name: 'Flash', pattern: 'flash', busId: 'main', scope: 'kit',
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
