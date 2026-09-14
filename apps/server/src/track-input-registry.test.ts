import { describe, expect, it, vi } from 'vitest';
import { TRACK_INPUT_LIMIT, TRACK_INPUT_TIMEOUT_MS, trackPacketSchema, type TrackPacket } from '@ledrums/protocol';
import { TrackInputRegistry, type TrackInputSink } from './track-input-registry';

const id = 'track-midi-1';
function fixture(acceptsMidiChannel?: TrackInputSink['acceptsMidiChannel']) {
  let now = 0;
  const sink: TrackInputSink = {
    midi: vi.fn(), cc: vi.fn(), osc: vi.fn(), audio: vi.fn(),
    ...(acceptsMidiChannel ? { acceptsMidiChannel } : {}),
  };
  const registry = new TrackInputRegistry(sink, () => now);
  const base = { v: 1 as const, id, session: 'session-1', seq: 0 };
  const hello = (patch: Partial<Extract<TrackPacket, { t: 'hello' }>> = {}, port = 2222) => registry.ingest({ ...base, t: 'hello', name: 'Drum track', kind: 'midi', ...patch }, port);
  const note = (seq: number, patch: Partial<Extract<TrackPacket, { t: 'midi' }>> = {}) => registry.ingest({ ...base, t: 'midi', seq, note: 38, velocity: 100, on: true, channel: 1, ...patch }, 2222);
  const bye = (seq: number, patch: Partial<Extract<TrackPacket, { t: 'bye' }>> = {}) => registry.ingest({ ...base, t: 'bye', seq, ...patch }, 2222);
  return { registry, sink, base, hello, note, bye, advance: (ms: number) => { now += ms; } };
}

describe('track input registry', () => {
  it('registers automatically without firing an input; stable hello updates names', () => {
    const f = fixture();
    expect(f.hello()).toEqual({ ok: true });
    expect(f.sink.midi).not.toHaveBeenCalled();
    expect(f.sink.audio).not.toHaveBeenCalled();
    expect(f.hello({ seq: 1, name: 'Renamed' })).toEqual({ ok: true });
    expect(f.registry.snapshot()).toMatchObject([{ id, name: 'Renamed', connected: true, received: 0 }]);
  });
  it('rejects data before registration and competing device identities/ports', () => {
    const f = fixture();
    expect(f.note(1)).toEqual({ ok: false, reason: 'register-first' });
    f.hello();
    expect(f.hello({ session: 'session-other', seq: 1 })).toEqual({ ok: false, reason: 'duplicate-id' });
    expect(f.registry.ingest({ ...f.base, t: 'hello', name: 'Other', kind: 'midi', seq: 1 }, 4444)).toEqual({ ok: false, reason: 'duplicate-id' });
    expect(f.registry.snapshot()[0]?.name).toBe('Drum track');
  });
  it('allows any channel without a hook and distinguishes note edges from gate values', () => {
    const f = fixture(); f.hello(); f.note(1, { channel: 3 }); f.note(2, { channel: 3, on: false });
    expect(f.sink.acceptsMidiChannel).toBeUndefined();
    expect(f.sink.midi).toHaveBeenNthCalledWith(1, { note: 38, channel: 3, velocity: 100, on: true });
    expect(f.sink.midi).toHaveBeenNthCalledWith(2, { note: 38, channel: 3, velocity: 0, on: false });
    expect(vi.mocked(f.sink.osc).mock.calls).toEqual([
      [`/tracks/${id}/midi/3/note/38`, 100 / 127, 'press'],
      [`/tracks/${id}/midi/3/gate/38`, 100 / 127],
      [`/tracks/${id}/midi/3/note/38`, 0, 'release'],
      [`/tracks/${id}/midi/3/gate/38`, 0],
    ]);
    expect(f.registry.snapshot()[0]).toMatchObject({ lastNote: 38, lastChannel: 3 });
  });
  it.each([
    { name: 'note/global-control press', packet: { t: 'midi', note: 60, velocity: 100, on: true, channel: 2 } },
    { name: 'unheld note-off', packet: { t: 'midi', note: 60, velocity: 100, on: false, channel: 2 } },
    { name: 'unheld velocity-zero press', packet: { t: 'midi', note: 60, velocity: 0, on: true, channel: 2 } },
    { name: 'CC0 recall', packet: { t: 'cc', controller: 0, value: 1, channel: 2 } },
    { name: 'global-control/scoped CC', packet: { t: 'cc', controller: 7, value: 127, channel: 2 } },
  ] as const)('blocks rejected-channel $name before raw/scoped effects or held tracking', ({ packet }) => {
    const accepts = vi.fn((channel: number) => channel === 1);
    const f = fixture(accepts); f.hello();
    const input = { ...f.base, seq: 1, ...packet };
    expect(f.registry.ingest(input, 2222)).toEqual({ ok: false, reason: 'channel-filtered' });
    expect(accepts.mock.calls).toEqual([[2]]);
    expect(f.sink.midi).not.toHaveBeenCalled();
    expect(f.sink.cc).not.toHaveBeenCalled();
    expect(f.sink.osc).not.toHaveBeenCalled();
    expect(f.sink.audio).not.toHaveBeenCalled();
    expect(f.registry.snapshot()[0]).toMatchObject({ received: 0, lastNote: null, lastChannel: null });
    // A policy change cannot make a previously rejected packet replayable.
    accepts.mockReturnValue(true);
    expect(f.registry.ingest(input, 2222)).toEqual({ ok: false, reason: 'out-of-order' });
    f.advance(TRACK_INPUT_TIMEOUT_MS + 1); f.registry.snapshot();
    expect(f.sink.midi).not.toHaveBeenCalled();
    expect(f.sink.cc).not.toHaveBeenCalled();
    expect(vi.mocked(f.sink.osc).mock.calls.filter(([address]) => address.includes('/midi/'))).toEqual([]);
    expect(accepts).toHaveBeenCalledTimes(1);
  });
  it.each([
    { on: false, velocity: 100 },
    { on: true, velocity: 0 },
  ])('releases an owned note after policy change: on=$on velocity=$velocity', (release) => {
    let allowedChannel = 1;
    const f = fixture((channel) => channel === allowedChannel); f.hello(); f.note(1);
    allowedChannel = 2;
    expect(f.note(2)).toEqual({ ok: false, reason: 'channel-filtered' });
    // Ownership belongs to this track AND this channel/note, not another track's press.
    f.hello({ id: 'second-track' });
    expect(f.note(1, { id: 'second-track', ...release })).toEqual({ ok: false, reason: 'channel-filtered' });
    expect(f.note(3, { note: 60, ...release })).toEqual({ ok: false, reason: 'channel-filtered' });
    expect(f.note(4, release)).toEqual({ ok: true });
    expect(f.note(5, release)).toEqual({ ok: false, reason: 'channel-filtered' });
    expect(vi.mocked(f.sink.midi).mock.calls).toEqual([
      [{ note: 38, channel: 1, velocity: 100, on: true }],
      [{ note: 38, channel: 1, velocity: 0, on: false }],
    ]);
    expect(vi.mocked(f.sink.osc).mock.calls).toEqual([
      [`/tracks/${id}/midi/1/note/38`, 100 / 127, 'press'],
      [`/tracks/${id}/midi/1/gate/38`, 100 / 127],
      [`/tracks/${id}/midi/1/note/38`, 0, 'release'],
      [`/tracks/${id}/midi/1/gate/38`, 0],
    ]);
    f.advance(TRACK_INPUT_TIMEOUT_MS + 1); f.registry.snapshot();
    expect(f.sink.midi).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.sink.osc).mock.calls.filter(([, , edge]) => edge === 'release')).toHaveLength(1);
  });
  it.each(['bye', 'timeout', 'close'] as const)('%s cleanup bypasses a changed policy and preserves shared raw-note ownership', (end) => {
    const accepts = vi.fn(() => true);
    const f = fixture(accepts); f.hello(); f.note(1);
    f.hello({ id: 'second-track' }); f.note(1, { id: 'second-track' });
    accepts.mockReturnValue(false);
    expect(f.note(2, { on: false })).toEqual({ ok: true });
    expect(f.sink.midi).toHaveBeenCalledTimes(2); // The second track still holds it.
    if (end === 'bye') expect(f.bye(2, { id: 'second-track' })).toEqual({ ok: true });
    else if (end === 'timeout') { f.advance(TRACK_INPUT_TIMEOUT_MS + 1); f.registry.snapshot(); }
    else f.registry.close();
    expect(accepts).toHaveBeenCalledTimes(2); // Only the two presses need current admission.
    expect(f.sink.midi).toHaveBeenCalledTimes(3);
    expect(f.sink.midi).toHaveBeenLastCalledWith({ note: 38, channel: 1, velocity: 0, on: false });
    expect(f.sink.osc).toHaveBeenCalledWith('/tracks/second-track/midi/1/note/38', 0, 'release');
    expect(f.sink.osc).toHaveBeenCalledWith('/tracks/second-track/midi/1/gate/38', 0);
    f.registry.snapshot(); f.registry.close();
    expect(f.sink.midi).toHaveBeenCalledTimes(3);
    expect(vi.mocked(f.sink.osc).mock.calls.filter(([, , edge]) => edge === 'release')).toHaveLength(2);
  });
  it('keeps accepted CCs raw and named values edge-free, including CC0', () => {
    const f = fixture((channel) => channel === 3); f.hello();
    for (const [seq, controller] of [0, 7].entries()) {
      expect(f.registry.ingest({ ...f.base, t: 'cc', seq: seq + 1, controller, value: 64, channel: 3 }, 2222)).toEqual({ ok: true });
      expect(f.sink.cc).toHaveBeenCalledWith({ controller, value: 64, channel: 3 });
      expect(f.sink.osc).toHaveBeenCalledWith(`/tracks/${id}/midi/3/cc/${controller}`, 64 / 127);
    }
    expect(f.bye(3)).toEqual({ ok: true });
    expect(f.sink.cc).toHaveBeenCalledTimes(2);
    expect(f.sink.osc).toHaveBeenCalledWith(`/tracks/${id}/midi/3/cc/0`, 0);
    expect(f.sink.osc).toHaveBeenCalledWith(`/tracks/${id}/midi/3/cc/7`, 0);
    expect(vi.mocked(f.sink.osc).mock.calls.every((call) => call.length === 2)).toBe(true);
  });
  it('keeps registration, audio and macros independent of MIDI admission and OSC edges', () => {
    const accepts = vi.fn(() => false);
    const f = fixture(accepts);
    expect(f.hello()).toEqual({ ok: true });
    expect(f.hello({ id: 'audio-track', kind: 'audio' })).toEqual({ ok: true });
    for (const source of [id, 'audio-track']) {
      expect(f.registry.ingest({ ...f.base, id: source, t: 'macro', seq: 1, index: 2, value: 0.7 }, 2222)).toEqual({ ok: true });
      expect(f.sink.osc).toHaveBeenCalledWith(`/tracks/${source}/macro/2`, 0.7);
    }
    const frame = { level: 0.8, bass: 0.4, mids: 0.2, highs: 0.1 };
    expect(f.registry.ingest({ ...f.base, id: 'audio-track', t: 'audio', seq: 2, ...frame }, 2222)).toEqual({ ok: true });
    expect(f.sink.audio).toHaveBeenCalledWith('audio-track', frame);
    for (const [band, value] of Object.entries(frame)) expect(f.sink.osc).toHaveBeenCalledWith(`/tracks/audio-track/audio/${band}`, value);
    expect(f.hello({ seq: 2, name: 'Renamed' })).toEqual({ ok: true });
    expect(accepts).not.toHaveBeenCalled();
    expect(f.sink.midi).not.toHaveBeenCalled();
    expect(f.sink.cc).not.toHaveBeenCalled();
    expect(vi.mocked(f.sink.osc).mock.calls.every((call) => call.length === 2)).toBe(true);
  });
  it('treats zero velocity as note-off and drops duplicates/out-of-order packets', () => {
    const f = fixture(); f.hello(); f.note(2, { velocity: 0 });
    expect(f.sink.midi).toHaveBeenCalledOnce();
    expect(f.sink.midi).toHaveBeenCalledWith({ note: 38, channel: 1, velocity: 0, on: false });
    expect(f.note(2)).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.note(1)).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.registry.snapshot()[0]?.dropped).toBe(1);
  });
  it('clears held notes/audio/macros on expiry with release edges, not presses or values', () => {
    const f = fixture(); f.hello(); f.note(1); f.advance(TRACK_INPUT_TIMEOUT_MS + 1);
    expect(f.registry.snapshot()[0]?.connected).toBe(false);
    expect(f.sink.midi).toHaveBeenLastCalledWith({ note: 38, channel: 1, velocity: 0, on: false });
    expect(f.sink.osc).toHaveBeenCalledWith(`/tracks/${id}/macro/1`, 0);
    expect(f.sink.osc).toHaveBeenCalledWith(`/tracks/${id}/midi/1/note/38`, 0, 'release');
    expect(f.sink.osc).not.toHaveBeenCalledWith(`/tracks/${id}/midi/1/note/38`, 0);
    expect(f.sink.osc).not.toHaveBeenCalledWith(`/tracks/${id}/midi/1/note/38`, 0, 'press');
    const n = vi.mocked(f.sink.midi).mock.calls.length;
    f.registry.snapshot(); f.registry.close();
    expect(vi.mocked(f.sink.midi).mock.calls).toHaveLength(n);
  });
  it('cannot silence another track holding the same channel/note', () => {
    const f = fixture(); f.hello(); f.note(1);
    f.hello({ id: 'second-track' }); f.note(1, { id: 'second-track' });
    f.note(2, { on: false });
    expect(f.sink.midi).toHaveBeenCalledTimes(2);
    f.note(2, { id: 'second-track', on: false });
    expect(f.sink.midi).toHaveBeenLastCalledWith({ note: 38, channel: 1, velocity: 0, on: false });
  });
  it.each(['bye', 'timeout'] as const)('rejects concrete hello(0)/note(1) replay after %s', (end) => {
    const f = fixture(); f.hello(); f.note(1);
    if (end === 'bye') expect(f.bye(2)).toEqual({ ok: true });
    else { f.advance(TRACK_INPUT_TIMEOUT_MS + 1); f.registry.snapshot(); }
    expect(f.hello()).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.note(1)).toMatchObject({ ok: false });
    expect(f.registry.snapshot()[0]).toMatchObject({ connected: false, received: 1 });
    expect(vi.mocked(f.sink.midi).mock.calls).toEqual([
      [{ note: 38, channel: 1, velocity: 100, on: true }],
      [{ note: 38, channel: 1, velocity: 0, on: false }],
    ]);
    expect(vi.mocked(f.sink.osc).mock.calls.filter(([, , edge]) => edge === 'press')).toHaveLength(1);
    expect(vi.mocked(f.sink.osc).mock.calls.filter(([, , edge]) => edge === 'release')).toHaveLength(1);
  });
  it('recovers an expired runtime only through a higher-seq heartbeat on its original peer', () => {
    const f = fixture(); f.hello(); f.note(10); f.advance(TRACK_INPUT_TIMEOUT_MS + 1);
    // Ingest performs expiry even if the status cadence has not observed it yet.
    expect(f.hello({ seq: 10 })).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.registry.snapshot()[0]).toMatchObject({ connected: false, received: 1, dropped: 9 });
    expect(f.note(11)).toEqual({ ok: false, reason: 'register-first' });
    expect(f.hello({ seq: 12 }, 4444)).toEqual({ ok: false, reason: 'register-first' });
    expect(f.hello({ seq: 12, kind: 'audio' })).toEqual({ ok: false, reason: 'kind-changed' });
    expect(f.hello({ seq: 12, name: 'Recovered' })).toEqual({ ok: true });
    expect(f.registry.snapshot()[0]).toMatchObject({ connected: true, name: 'Recovered', received: 1, dropped: 10 });
    expect(f.note(11)).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.note(12)).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.note(13)).toEqual({ ok: true });
    expect(f.registry.snapshot()[0]).toMatchObject({ received: 2, dropped: 10 });
    expect(vi.mocked(f.sink.midi).mock.calls.map(([input]) => input.on)).toEqual([true, false, true]);
    // A second timeout keeps the same ordering watermark, too.
    f.advance(TRACK_INPUT_TIMEOUT_MS + 1); f.registry.snapshot();
    expect(f.hello({ seq: 12 })).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.hello({ seq: 14 })).toEqual({ ok: true });
  });
  it('does not let duplicate heartbeats refresh the lease', () => {
    const f = fixture(); f.hello(); f.note(1);
    f.advance(TRACK_INPUT_TIMEOUT_MS);
    expect(f.registry.snapshot()[0]?.connected).toBe(true);
    expect(f.hello({ seq: 1 })).toEqual({ ok: false, reason: 'out-of-order' });
    f.advance(1);
    expect(f.registry.snapshot()[0]?.connected).toBe(false);
  });
  it('permits same-runtime port/identity round trips only with a higher-seq hello on the original peer', () => {
    const f = fixture(); f.hello(); f.note(1); f.bye(2);
    expect(f.note(3)).toEqual({ ok: false, reason: 'register-first' });
    expect(f.hello({ seq: 100 }, 4444)).toEqual({ ok: false, reason: 'register-first' });
    expect(f.hello({ seq: 2 })).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.hello({ seq: 100 })).toEqual({ ok: true });
    expect(f.note(1)).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.sink.midi).toHaveBeenCalledTimes(2);
    expect(f.note(101)).toEqual({ ok: true });
    expect(f.registry.snapshot()[0]).toMatchObject({ connected: true, received: 2 });
  });
  it('closes a timed-out runtime on a fresh bye without repeating cleanup', () => {
    const f = fixture(); f.hello(); f.note(1); f.advance(TRACK_INPUT_TIMEOUT_MS + 1); f.registry.snapshot();
    const calls = vi.mocked(f.sink.osc).mock.calls.length;
    expect(f.bye(1)).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.bye(2)).toEqual({ ok: true });
    expect(f.hello({ seq: 2 })).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.hello({ seq: 3 })).toEqual({ ok: true });
    expect(f.sink.osc).toHaveBeenCalledTimes(calls);
    expect(f.sink.midi).toHaveBeenCalledTimes(2);
  });
  it.each(['bye', 'timeout'] as const)('allows a new runtime/peer to reset sequence after %s, not old data', (end) => {
    const f = fixture(); f.hello(); f.note(10);
    if (end === 'bye') f.bye(11);
    else f.advance(TRACK_INPUT_TIMEOUT_MS + 1);
    expect(f.hello({ session: 'session-2' }, 4444)).toEqual({ ok: true });
    expect(f.registry.snapshot()[0]).toMatchObject({ connected: true, received: 0, dropped: 0, lastNote: null });
    expect(f.note(11)).toEqual({ ok: false, reason: 'register-first' });
    expect(f.bye(12)).toEqual({ ok: false, reason: 'register-first' });
    expect(f.hello({ seq: 13 })).toEqual({ ok: false, reason: 'duplicate-id' });
    expect(f.registry.ingest({ ...f.base, session: 'session-2', seq: 1, t: 'midi', note: 60, velocity: 127, on: true, channel: 1 }, 4444)).toEqual({ ok: true });
    expect(f.registry.snapshot()[0]).toMatchObject({ connected: true, received: 1, dropped: 0, lastNote: 60 });
    expect(vi.mocked(f.sink.midi).mock.calls.map(([input]) => input.on)).toEqual([true, false, true]);
  });
  it('audio freshness is independent of a connected heartbeat', () => {
    const f = fixture(); f.hello({ kind: 'audio' });
    expect(f.registry.ingest({ ...f.base, t: 'audio', seq: 1, level: 0.8, bass: 0.4, mids: 0.2, highs: 0.1 }, 2222)).toEqual({ ok: true });
    expect(f.sink.audio).toHaveBeenLastCalledWith(id, { level: 0.8, bass: 0.4, mids: 0.2, highs: 0.1 });
    f.advance(501); f.hello({ kind: 'audio', seq: 2 });
    expect(f.registry.snapshot()[0]).toMatchObject({ connected: true, audio: { level: 0, bass: 0, mids: 0, highs: 0 } });
    expect(f.sink.osc).toHaveBeenCalledWith(`/tracks/${id}/audio/bass`, 0);
  });
  it('keeps audio sources independent and snapshots cannot mutate state', () => {
    const f = fixture(); f.hello({ kind: 'audio' }); f.hello({ kind: 'audio', id: 'second-track' });
    f.registry.ingest({ ...f.base, t: 'audio', seq: 1, level: 0.8, bass: 0, mids: 0, highs: 0 }, 2222);
    const snapshot = f.registry.snapshot(); snapshot[0]!.audio.level = 0.1;
    expect(f.registry.snapshot().map((i) => i.audio.level)).toEqual([0.8, 0]);
  });
  it('rejects capability changes and wrong-kind payloads', () => {
    const f = fixture(); f.hello({ kind: 'audio' });
    expect(f.note(1)).toEqual({ ok: false, reason: 'wrong-kind' });
    expect(f.hello({ seq: 2 })).toEqual({ ok: false, reason: 'kind-changed' });
    expect(f.sink.midi).not.toHaveBeenCalled();
  });
  it('bounds connected devices and evicts disconnected ones rather than live inputs', () => {
    const f = fixture();
    for (let i = 0; i < TRACK_INPUT_LIMIT; i++) expect(f.hello({ id: `track-${String(i).padStart(4, '0')}` })).toEqual({ ok: true });
    expect(f.hello()).toEqual({ ok: false, reason: 'capacity' });
    f.advance(TRACK_INPUT_TIMEOUT_MS + 1);
    expect(f.hello()).toEqual({ ok: true });
    expect(f.registry.snapshot()).toHaveLength(TRACK_INPUT_LIMIT);
  });
  it('bounds retained tombstones at 32 total entries and never evicts the live runtime', () => {
    const f = fixture(); f.hello(); f.note(1);
    expect(TRACK_INPUT_LIMIT).toBe(32);
    for (let i = 0; i < TRACK_INPUT_LIMIT + 8; i++) {
      f.advance(1);
      const retiredId = `retired-track-${i}`;
      expect(f.hello({ id: retiredId })).toEqual({ ok: true });
      expect(f.bye(1, { id: retiredId })).toEqual({ ok: true });
      expect(f.registry.snapshot().length).toBeLessThanOrEqual(TRACK_INPUT_LIMIT);
    }
    const snapshot = f.registry.snapshot();
    expect(snapshot).toHaveLength(TRACK_INPUT_LIMIT);
    expect(snapshot.filter((input) => input.connected).map((input) => input.id)).toEqual([id]);
    expect(snapshot.some((input) => input.id === 'retired-track-8')).toBe(false);
    expect(snapshot.some((input) => input.id === 'retired-track-9')).toBe(true);
    expect(f.hello({ id: 'retired-track-39', seq: 1 })).toEqual({ ok: false, reason: 'out-of-order' });
    expect(f.note(2)).toEqual({ ok: true });
    // Deliberate bounded replay horizon: evicted identities have no archived nonce history.
    expect(f.hello({ id: 'retired-track-0' })).toEqual({ ok: true });
    expect(f.registry.snapshot()).toHaveLength(TRACK_INPUT_LIMIT);
    f.registry.close();
    expect(f.registry.snapshot()).toEqual([]);
  });
  it('bounds per-source ingress; unknown message fields cannot become editor commands', () => {
    const f = fixture(); f.hello();
    for (let seq = 1; seq <= 511; seq++) expect(f.note(seq)).toEqual({ ok: true });
    expect(f.note(512)).toEqual({ ok: false, reason: 'rate-limit' });
    expect(trackPacketSchema.safeParse({ ...f.base, t: 'setShow', show: {} }).success).toBe(false);
    expect(trackPacketSchema.safeParse({ ...f.base, t: 'hello', name: 'X', kind: 'midi', hostToken: 'nope' }).success).toBe(false);
  });
});
