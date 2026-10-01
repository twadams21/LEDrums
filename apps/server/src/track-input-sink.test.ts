import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { defaultProject, effectChain, withGlobalControlBinding, type voice } from '@ledrums/core';
import { trackPacketSchema, type ServerMessage } from '@ledrums/protocol';
import { OutputManager } from './output-manager';
import { VoiceEngineHost } from './voice-engine-host';
import { TrackInputRegistry } from './track-input-registry';
import { createTrackInputSink } from './track-input-sink';

const MIDI_ID = 'render_midi';
const AUDIO_ID = 'render_audio';
const noteAddress = `/tracks/${MIDI_ID}/midi/1/note/60`;
/** A looping solid Cue on `source` (default MIDI note 61). With `modulation`, its brightness
    (base 0) follows the audio level or the track's OSC level address. */
function cue(id: string, modulation?: 'audio' | 'osc', source: Record<string, unknown> = { midiNote: 61 }): effectChain.Effect {
  const control = modulation === 'audio'
    ? { uid: 'm', kind: 'audio', settings: { band: 'level' } }
    : { uid: 'm', kind: 'osc', settings: { address: `/tracks/${AUDIO_ID}/audio/level` } };
  return effectChain.parseEffect({
    id,
    cell: { row: 'kit', column: { kind: 'cue' } },
    trigger: { kind: 'cue', source },
    generator: { kind: 'solid', style: 'solid', params: { brightness: modulation ? 0 : 1 } },
    amp: { attackMs: 0, length: 'loop', releaseMs: 0 },
    // A re-hit restarts the loop rather than stacking a second one.
    retrigger: 'restart',
    controls: modulation
      ? [{ ...control, mappings: [{ device: 'generator', param: 'brightness', amount: 1, invert: false, rangeMin: 0, rangeMax: 1 }] }]
      : [],
  });
}
function showOf(effects: effectChain.Effect[], sectionIds = ['s']): voice.Show {
  return { songs: [{ id: 'song', name: 'Song', sections: sectionIds.map((id) => ({ id, name: id, effects })) }] };
}
function show(modulation?: 'audio' | 'osc'): voice.Show {
  return showOf([cue('fx', modulation)]);
}
function rig(modulation?: 'audio' | 'osc') {
  const project = defaultProject();
  project.output.state = 'disabled';
  const host = new VoiceEngineHost(project, null, new OutputManager(() => { throw new Error('Physical adapter forbidden'); }));
  host.setShow(show(modulation));
  const echoes: ServerMessage[] = [];
  const registry = new TrackInputRegistry(createTrackInputSink(host, (m) => echoes.push(m)), () => now);
  let now = 0, seq = 0;
  let rgb = new Uint8Array();
  host.onFrame = (frame) => { rgb = frame.slice(); };
  const render = () => { for (let i = 0; i < 4; i++) host.step(1000 / 120); return rgb.reduce((sum, v) => sum + v, 0); };
  const send = (body: object, id = MIDI_ID) => registry.ingest(trackPacketSchema.parse({ v: 1, id, session: 'render_session', seq: seq++, ...body }), 53001);
  const hello = (kind: 'midi' | 'audio' = 'midi', id = MIDI_ID) => send({ t: 'hello', name: `Synthetic ${kind}`, kind }, id);
  const midi = (note: number, on = true, channel = 1) => send({ t: 'midi', note, on, velocity: on ? 127 : 0, channel });
  const audio = (level: number, id = AUDIO_ID) => send({ t: 'audio', level, bass: level, mids: level, highs: level }, id);
  return { host, registry, echoes, render, send, hello, midi, audio, expire: () => { now += 3001; registry.snapshot(); } };
}

describe('local track production sink → real host → preview (physical adapters forbidden)', () => {
  it('the actual foreign session client can return from port and saved-identity edits without resetting sequence', () => {
    const { createSession } = createRequire(import.meta.url)('../../../integrations/ableton/session.cjs');
    const r = rig();
    const replies: Buffer[] = [];
    const client = createSession({
      id: MIDI_ID, session: 'interop_session', name: 'Synthetic round trip', kind: 'midi', port: 4395, now: () => 100,
      send: (data: Buffer, destination: number) => {
        if (destination !== 4395) return true; // an unused loopback destination, no real socket
        const packet = trackPacketSchema.parse(JSON.parse(data.toString()));
        const admitted = r.registry.ingest(packet, 53001);
        if (packet.t === 'hello') replies.push(Buffer.from(JSON.stringify({ v: 1, t: 'ack', id: packet.id, session: packet.session, seq: packet.seq, ...admitted })));
        return true;
      },
    });
    const receive = () => { for (const reply of replies.splice(0)) client.receive(reply, { address: '127.0.0.1', port: 4395 }); };
    client.start(); receive(); expect(client.connected).toBe(true);
    client.midi([0x90, 61, 127]); expect(r.render()).toBeGreaterThan(0);
    client.setPort(4396); expect(r.registry.snapshot()[0]?.connected).toBe(false);
    client.setPort(4395); receive(); expect(client.connected).toBe(true);
    client.newIdentity('another_saved_id'); receive(); expect(client.connected).toBe(true);
    client.newIdentity(MIDI_ID); receive(); expect(client.connected).toBe(true);
    client.midi([0x90, 61, 127]); expect(r.render()).toBeGreaterThan(0);
    client.close(); expect(r.registry.snapshot().every((input) => !input.connected)).toBe(true);
  });
  it.each(['release', 'expiry'] as const)('a scoped note completes momentary blackout on %s, without refiring', (end) => {
    const r = rig();
    r.host.setInputMap({ ...r.host.getInputMap(), globalControls: withGlobalControlBinding({}, 'panicBlackoutMomentary', { oscAddress: noteAddress }) });
    r.hello(); r.midi(61);
    expect(r.render()).toBeGreaterThan(0);
    r.midi(60); expect(r.render()).toBe(0);
    if (end === 'release') r.midi(60, false); else r.expire();
    expect(r.render()).toBeGreaterThan(0);
    expect(r.host.getStats().engine.voiceCount).toBe(1);
    const release = r.echoes.filter((m) => m.t === 'input' && m.label === noteAddress).at(-1);
    expect(release).toMatchObject({ value: 0, modulationOnly: true, trackInputId: MIDI_ID });
  });

  it('filters raw and scoped wrong-channel MIDI before Cue/global/control resolution', () => {
    const r = rig();
    r.host.setInputMap({ ...r.host.getInputMap(), midiChannel: 1,
      globalControls: withGlobalControlBinding({}, 'panicBlackoutMomentary', { midiNote: 60 }) });
    // A second Cue on the channel-2 track address: it must never see a filtered message either.
    r.host.setShow(showOf([cue('fx'), cue('scoped', undefined, { oscAddress: `/tracks/${MIDI_ID}/midi/2/note/61` })]));
    r.hello(); r.midi(61, true, 2);
    expect(r.render()).toBe(0); expect(r.host.getStats().engine.voiceCount).toBe(0);
    r.midi(61); expect(r.render()).toBeGreaterThan(0);
    r.midi(60, true, 2); expect(r.render()).toBeGreaterThan(0);
    expect(r.echoes.some((m) => m.t === 'input' && m.channel === 2)).toBe(false);
  });

  it('filters wrong-channel CC0 recalls and globally bound brightness CCs', () => {
    const r = rig();
    r.host.setInputMap({ ...r.host.getInputMap(), midiChannel: 1,
      globalControls: withGlobalControlBinding({}, 'masterBrightness', { midiCc: 7 }) });
    r.host.setShow(showOf([cue('fx')], ['a', 'b']));
    r.host.applyInput({ kind: 'recallSection', songId: 'song', sectionId: 'a' }); r.render();
    r.hello(); r.midi(61); expect(r.render()).toBeGreaterThan(0);
    r.send({ t: 'cc', controller: 0, value: 1, channel: 2 });
    r.send({ t: 'cc', controller: 7, value: 0, channel: 2 });
    expect(r.render()).toBeGreaterThan(0);
    expect(r.host.getActiveSelection().activeSectionId).toBe('a');
    r.send({ t: 'cc', controller: 0, value: 1, channel: 1 }); r.render();
    expect(r.host.getActiveSelection().activeSectionId).toBe('b');
    r.send({ t: 'cc', controller: 7, value: 0, channel: 1 }); expect(r.render()).toBe(0);
  });

  it.each(['audio', 'osc'] as const)('%s modulation renders dark → lit → stale dark through registration', (modulation) => {
    const r = rig(modulation);
    r.host.setInputMap({ ...r.host.getInputMap(), trackAudioInput: AUDIO_ID });
    r.hello(); r.hello('audio', AUDIO_ID); r.midi(61); expect(r.render()).toBe(0);
    r.audio(0.8); expect(r.render()).toBeGreaterThan(0);
    r.expire(); expect(r.render()).toBe(0);
    expect(r.host.getStats().engine.voiceCount).toBe(1);
    expect(r.echoes.filter((m) => m.t === 'input' && m.label.includes('/audio/')).every((m) => m.t === 'input' && m.modulationOnly)).toBe(true);
  });

  it('an unselected track cannot replace the selected Audio source', () => {
    const r = rig('audio');
    r.host.setInputMap({ ...r.host.getInputMap(), trackAudioInput: AUDIO_ID });
    r.hello(); r.hello('audio', AUDIO_ID); r.hello('audio', 'other_audio'); r.midi(61);
    r.audio(0.8, 'other_audio'); expect(r.render()).toBe(0);
    r.audio(0.8); expect(r.render()).toBeGreaterThan(0);
    r.audio(0, 'other_audio'); expect(r.render()).toBeGreaterThan(0);
  });

  it('modulation echoes and streams cannot invoke global controls; presses remain learnable', () => {
    const r = rig();
    r.host.setInputMap({ ...r.host.getInputMap(), globalControls: withGlobalControlBinding({}, 'panicBlackoutMomentary', { oscAddress: `/tracks/${AUDIO_ID}/audio/level` }) });
    r.hello(); r.hello('audio', AUDIO_ID); r.midi(61); expect(r.render()).toBeGreaterThan(0);
    r.audio(1); expect(r.render()).toBeGreaterThan(0);
    expect(r.echoes.find((m) => m.t === 'input' && m.label.endsWith('/note/61'))).toMatchObject({ trackInputId: MIDI_ID });
    expect(r.echoes.find((m) => m.t === 'input' && m.label.endsWith('/audio/level'))).toMatchObject({ trackInputId: AUDIO_ID, modulationOnly: true });
  });
});
