import { describe, expect, it, vi } from 'vitest';
import { defaultProject, effectChain, type voice } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { serverMessageSchema, type ServerMessage } from '@ledrums/protocol';
import { OutputManager } from '../output-manager';
import { VoiceEngineHost } from '../voice-engine-host';
import { handleVoiceInput, type VoiceInputDeps } from './voice-input';

/* S12 — the server is the sole authoritative resolver when a client is connected. This asserts
   the count that the authority principle promises: ONE MIDI hit produces exactly ONE input echo
   broadcast and exactly ONE voice per matching Effect — no re-fire, no duplicate broadcast. (The old duplicate fires were client-side echo, not the server; this locks the
   server end down so later E slices can rely on it.) */

class FakeOutput implements PixelOutput {
  nextFrame(): void {}
  send(): void {}
  close(): void {}
}

/** One Cue Effect bound DIRECTLY to a raw MIDI note (no zone-map), a kit-wide solid flash. An
    unmapped note therefore fires exactly one Effect. `over` merges into the authored Effect. */
function cueShow(note: number, over: Record<string, unknown> = {}): voice.Show {
  const flash = effectChain.parseEffect({
    id: 'fx-flash',
    cell: { row: 'kit', column: { kind: 'cue' } },
    trigger: { kind: 'cue', source: { midiNote: note } },
    generator: { kind: 'solid', style: 'swirl', params: { brightness: 1 } },
    amp: { attackMs: 0, length: { ms: 200 }, releaseMs: 200 },
    ...over,
  });
  return { songs: [{ id: 'song', name: 'Song', sections: [{ id: 'section', name: 'Section', effects: [flash] }] }] };
}

function makeHost(): VoiceEngineHost {
  return new VoiceEngineHost(defaultProject(), null, new OutputManager(() => new FakeOutput()));
}

describe('handleVoiceInput — one connected MIDI hit fires once (S12)', () => {
  it('a single MIDI note broadcasts exactly one input echo and fires exactly one Effect', () => {
    const host = makeHost();
    host.setShow(cueShow(60)); // note 60 is unmapped in defaultProject → the Cue only

    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };

    const handled = handleVoiceInput({ t: 'midi', note: 60, velocity: 127, on: true, channel: 0 }, deps);
    for (let i = 0; i < 4; i++) host.step(1000 / 120); // let the voice reach level

    expect(handled).toBe(true);

    // Exactly one `input` broadcast (the monitor "input" line), carrying this note.
    const inputBroadcasts = broadcasts.filter((m) => m.t === 'input');
    expect(inputBroadcasts).toHaveLength(1);
    expect(inputBroadcasts[0]).toMatchObject({ t: 'input', kind: 'midi', note: 60 });

    // Exactly one voice — one authoritative fire, no re-fire — and it is lit.
    expect(host.getStats().engine.voiceCount).toBe(1);
    const litBuses = Object.values(host.getStats().engine.busLevels).filter((l) => l > 0);
    expect(litBuses).toHaveLength(1);
  });

  it('the note-off for the same hit adds no extra fire', () => {
    const host = makeHost();
    host.setShow(cueShow(60));

    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };

    handleVoiceInput({ t: 'midi', note: 60, velocity: 127, on: true, channel: 0 }, deps);
    handleVoiceInput({ t: 'midi', note: 60, velocity: 0, on: false, channel: 0 }, deps);
    for (let i = 0; i < 4; i++) host.step(1000 / 120);

    // Note-on + note-off each echo once; only the note-on fires.
    expect(broadcasts.filter((m) => m.t === 'input')).toHaveLength(2);
    expect(host.getStats().engine.voiceCount).toBe(1);
  });
});

describe('handleVoiceInput — transport recall stays engine-authoritative', () => {
  it('resolves queued PC then CC#0 against the processed engine position', () => {
    const host = makeHost();
    const show: voice.Show = {
      songs: [
        { id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', effects: [] }, { id: 'a1', name: 'A1', effects: [] }] },
        { id: 'song-b', name: 'B', sections: [{ id: 'b0', name: 'B0', effects: [] }, { id: 'b1', name: 'B1', effects: [] }] },
      ],
    };
    host.setShow(show);
    const recalls: Array<{ songId: string | null; sectionId: string | null }> = [];
    host.onSectionRecalled = (songId, sectionId) => recalls.push({ songId, sectionId });
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: () => {} };

    handleVoiceInput({ t: 'programChange', value: 1 }, deps);
    // This CC arrives before the PC has drained. It must still land on B1, not A1.
    handleVoiceInput({ t: 'cc', controller: 0, value: 1 }, deps);
    host.step(1000 / 120);

    expect(recalls).toEqual([
      { songId: 'song-b', sectionId: 'b0' },
      { songId: 'song-b', sectionId: 'b1' },
    ]);
  });

  it('does not acknowledge an out-of-range indexed recall', () => {
    const host = makeHost();
    host.setShow({ songs: [{ id: 'song-a', name: 'A', sections: [{ id: 'a0', name: 'A0', effects: [] }] }] });
    const recalled = vi.fn();
    host.onSectionRecalled = recalled;
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: () => {} };
    handleVoiceInput({ t: 'cc', controller: 0, value: 99 }, deps);
    host.step(1000 / 120);
    expect(recalled).not.toHaveBeenCalled();
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

  it('echoes a CC (not CC 0) with its controller and normalised value, so the web sees CC-mapped bypass toggles', () => {
    const host = makeHost();
    const broadcasts: ServerMessage[] = [];
    const deps: VoiceInputDeps = { voiceHost: host, broadcastJson: (m) => broadcasts.push(m) };
    handleVoiceInput({ t: 'cc', controller: 21, value: 127, channel: 2 }, deps);
    handleVoiceInput({ t: 'cc', controller: 21, value: 0 }, deps);

    const [press, release] = echoes(broadcasts);
    expect(press).toEqual({ t: 'input', kind: 'midi', label: 'cc 21', value: 1, controller: 21, channel: 2 });
    expect(release).toEqual({ t: 'input', kind: 'midi', label: 'cc 21', value: 0, controller: 21 });
    // The wire schema is strict: the echo must survive the client's decode.
    expect(serverMessageSchema.safeParse(press).success).toBe(true);
    // CC 0 keeps its own section-recall echo (no controller field).
    handleVoiceInput({ t: 'cc', controller: 0, value: 1 }, deps);
    expect(echoes(broadcasts)[2]).toEqual({ t: 'input', kind: 'midi', label: 'CC0 1', value: 1 });
  });
});

/* GH #214 — audio feature frames reach the engine's audio table through the voice host (stamped
   with the engine clock, never a trigger), only from the editor, and never as monitor traffic. */
describe('handleVoiceInput — audioFeatures', () => {
  /** A looping Cue on note 60 whose brightness (base 0) follows the audio level. */
  function audioShow(): voice.Show {
    return cueShow(60, {
      generator: { kind: 'solid', style: 'swirl', params: { hue: 0, saturation: 1, brightness: 0, speed: 0, noise: 0 } },
      amp: { attackMs: 0, length: 'loop', releaseMs: 100 },
      controls: [{ uid: 'a1', kind: 'audio', settings: { band: 'level' }, mappings: [{ device: 'generator', param: 'brightness', amount: 1, invert: false, rangeMin: 0, rangeMax: 1 }] }],
    });
  }

  const STEP = 1000 / 120;
  /** Advance the host by `ms` at the 120 Hz tick; the preview callback fires at ~30 fps. */
  function run(host: VoiceEngineHost, ms: number): void {
    for (let t = 0; t < ms; t += STEP) host.step(STEP);
  }
  const lit = (rgb: Uint8Array | null): number => {
    if (!rgb) throw new Error('no preview frame emitted');
    let s = 0;
    for (const b of rgb) s += b;
    return s;
  };

  function litHost(): { host: VoiceEngineHost; broadcast: ReturnType<typeof vi.fn>; frame: () => Uint8Array | null } {
    const host = makeHost();
    host.setShow(audioShow());
    let last: Uint8Array | null = null;
    host.onFrame = (rgb) => { last = rgb; };
    const broadcast = vi.fn();
    handleVoiceInput({ t: 'midi', note: 60, velocity: 127, on: true }, { voiceHost: host, broadcastJson: broadcast });
    run(host, 100);
    return { host, broadcast, frame: () => last };
  }

  it("the editor's frame drives the engine (mapped param lights the voice) with no echo or monitor traffic", () => {
    const { host, broadcast, frame } = litHost();
    broadcast.mockClear();
    expect(lit(frame())).toBe(0);
    const handled = handleVoiceInput({ t: 'audioFeatures', level: 1, bass: 0, mids: 0, highs: 0 }, { voiceHost: host, broadcastJson: broadcast, viewer: false });
    run(host, 100);
    expect(handled).toBe(true);
    expect(lit(frame())).toBeGreaterThan(0);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('selecting a track prevents browser frames overwriting it; returning to browser restores capture', () => {
    const { host, broadcast, frame } = litHost();
    host.setInputMap({ ...host.getInputMap(), trackAudioInput: 'audio-track' });
    handleVoiceInput({ t: 'audioFeatures', level: 1, bass: 0, mids: 0, highs: 0 }, { voiceHost: host, broadcastJson: broadcast });
    run(host, 100);
    expect(lit(frame())).toBe(0);
    host.applyInput({ kind: 'audioFeatures', level: 0.8, bass: 0, mids: 0, highs: 0 });
    run(host, 100);
    expect(lit(frame())).toBeGreaterThan(0);
    const { trackAudioInput: _selected, ...inputMap } = host.getInputMap();
    host.setInputMap(inputMap);
    handleVoiceInput({ t: 'audioFeatures', level: 0, bass: 0, mids: 0, highs: 0 }, { voiceHost: host, broadcastJson: broadcast });
    run(host, 100);
    expect(lit(frame())).toBe(0);
  });

  it("a viewer's frame is dropped: the engine never sees it", () => {
    const { host, broadcast, frame } = litHost();
    const handled = handleVoiceInput({ t: 'audioFeatures', level: 1, bass: 0, mids: 0, highs: 0 }, { voiceHost: host, broadcastJson: broadcast, viewer: true });
    run(host, 100);
    expect(handled).toBe(true);
    expect(lit(frame())).toBe(0);
  });

  it('a frame is a modulation value, not a trigger: it spawns no voice', () => {
    const host = makeHost();
    host.setShow(audioShow());
    handleVoiceInput({ t: 'audioFeatures', level: 1, bass: 1, mids: 1, highs: 1 }, { voiceHost: host, broadcastJson: vi.fn() });
    run(host, 100);
    expect(host.getStats().engine.voiceCount).toBe(0);
  });

  it('goes stale on the HOST clock: with no new frame the mapped param returns to zero', () => {
    const { host, broadcast, frame } = litHost();
    handleVoiceInput({ t: 'audioFeatures', level: 1, bass: 0, mids: 0, highs: 0 }, { voiceHost: host, broadcastJson: broadcast });
    run(host, 100);
    expect(lit(frame())).toBeGreaterThan(0);
    run(host, 800); // > AUDIO_STALE_MS, no further frame
    expect(lit(frame())).toBe(0);
  });

  it('legacy mode (no voice host) consumes the frame as a no-op', () => {
    expect(handleVoiceInput({ t: 'audioFeatures', level: 1, bass: 0, mids: 0, highs: 0 }, { voiceHost: null, broadcastJson: vi.fn() })).toBe(true);
  });
});
