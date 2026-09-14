'use strict';

const {
  DEFAULT_PORT, assertId, assertName, assertKind, assertPort, integer, unit,
  createPacketWriter, decodeAck,
} = require('./packets.cjs');
const { ZERO_FRAME, PUBLISH_MS } = require('./audio.cjs');
const { createMidiParser } = require('./midi.cjs');

const HEARTBEAT_MS = 1000;
const ACK_TIMEOUT_MS = 3000;
const FEATURE_STALE_MS = 500;
const MIDI_PER_SECOND = 128; // Plus <=240 macros + <=30 audio + hello: below server 512/s.

/** IO-free runtime policy, with clock and fire-and-forget send injected.
 * No replay queue: notes preserve admitted order; continuous controls keep one latest value.
 * A duplicate-id rejection latches until explicit New identity. Losing a server does not mint
 * identities/nonces or reset sequence. ACKs acknowledge registration, not data delivery. */
function createSession(options) {
  const now = options.now;
  const write = createPacketWriter(options.session);
  const kind = assertKind(options.kind);
  let id = assertId(options.id);
  let name = assertName(options.name);
  let port = assertPort(options.port ?? DEFAULT_PORT);
  let started = false;
  let stopped = false;
  let blocked = false;
  let connected = false;
  let state = 'idle';
  let lastHelloAt = -Infinity;
  let lastAckAt = -Infinity;
  let lastAckSeq = -1;
  const pendingHellos = new Map(); // At most four requests, never an unbounded replay log.
  let lastPublishAt = -Infinity;
  let lastMacroRefreshAt = -Infinity;
  let audio = null;
  let audioAt = -Infinity;
  const macros = Array(8).fill(null);
  const dirtyMacros = new Set();
  let midiAt = -Infinity;
  let midiCount = 0;

  function status(next) {
    if (state === next) return;
    state = next;
    options.onStatus?.(next);
  }
  function clearRuntime() {
    connected = false;
    pendingHellos.clear();
    lastHelloAt = lastAckAt = lastPublishAt = lastMacroRefreshAt = -Infinity;
    lastAckSeq = -1;
    audio = null;
    audioAt = -Infinity;
    parser.reset();
    for (let i = 0; i < macros.length; i++) if (macros[i] !== null) dirtyMacros.add(i);
  }
  function send(message, bestEffort = false) {
    try {
      const encoded = write(id, message);
      const accepted = options.send(encoded.data, port) !== false;
      if (!accepted && !bestEffort) fault('transport-error');
      return accepted ? encoded.packet : null;
    } catch {
      if (!bestEffort) fault('transport-error');
      return null;
    }
  }
  function fault(reason) {
    if (stopped) return;
    // Silence the lease on overload. Continuing heartbeats after dropping a note-off could
    // otherwise keep a stuck note alive indefinitely. Bye is best effort; expiry is fallback.
    stopped = true; // Latch before best-effort IO: a synchronous send error may re-enter.
    if (started && !blocked) send({ t: 'bye' }, true);
    clearRuntime();
    status(reason);
  }
  const parser = createMidiParser((message) => {
    if (!started || stopped || blocked || !connected) return;
    const time = now();
    if (time - midiAt >= 1000) { midiAt = time; midiCount = 0; }
    if (++midiCount > MIDI_PER_SECOND) { fault('overload'); return; }
    send(message);
  });

  function tick() {
    if (!started || stopped || blocked) return;
    const time = now();
    if (connected && time - lastAckAt > ACK_TIMEOUT_MS) {
      connected = false;
      status('waiting');
    }
    if (time - lastHelloAt >= HEARTBEAT_MS) {
      lastHelloAt = time;
      const packet = send({ t: 'hello', name, kind });
      if (packet) {
        pendingHellos.set(packet.seq, time);
        while (pendingHellos.size > 4) pendingHellos.delete(pendingHellos.keys().next().value);
      }
    }
    if (!connected || stopped || time - lastPublishAt < PUBLISH_MS) return;
    lastPublishAt = time;
    if (kind === 'audio' && audio && time - audioAt <= FEATURE_STALE_MS) send({ t: 'audio', ...audio });
    const refresh = time - lastMacroRefreshAt >= HEARTBEAT_MS;
    if (refresh) lastMacroRefreshAt = time;
    for (let i = 0; i < 8 && !stopped; i++) {
      if (macros[i] !== null && (refresh || dirtyMacros.has(i))) {
        send({ t: 'macro', index: i + 1, value: macros[i] });
        dirtyMacros.delete(i);
      }
    }
  }
  return {
    get id() { return id; },
    get port() { return port; },
    get state() { return state; },
    get connected() { return connected; },
    start() {
      if (started || stopped) return;
      started = true;
      status('waiting');
      tick();
    },
    tick,
    receive(data, peer) {
      if (!started || stopped || blocked || peer?.address !== '127.0.0.1' || peer.port !== port) return false;
      const ack = decodeAck(data);
      if (!ack || ack.id !== id || ack.session !== options.session || ack.seq <= lastAckSeq) return false;
      const sentAt = pendingHellos.get(ack.seq);
      if (sentAt === undefined || now() - sentAt > ACK_TIMEOUT_MS) return false;
      lastAckSeq = ack.seq;
      for (const seq of pendingHellos.keys()) if (seq <= ack.seq) pendingHellos.delete(seq);
      if (!ack.ok) {
        connected = false;
        if (ack.reason === 'duplicate-id') {
          parser.reset();
          blocked = true;
          // Do not send bye for someone else's lease; do not auto-retry this identity.
          pendingHellos.clear();
          status('duplicate-id');
        } else {
          status(ack.reason);
        }
        return true;
      }
      connected = true;
      lastAckAt = now();
      status('connected');
      return true;
    },
    midi(bytes) {
      if (kind !== 'midi' || !started || stopped || blocked) return;
      if (!Array.isArray(bytes) || bytes.length > 256) { fault('overload'); return; }
      // Parse even before an ACK: completed events are dropped by emit's connected guard,
      // but a source using only running status must still work when the app appears later.
      for (const byte of bytes) parser.push(byte);
    },
    audio(frame) {
      if (kind !== 'audio') throw new Error('MIDI sources cannot send audio');
      // Validate before storing: invalid or additional fields never enter the send loop.
      const keys = Object.keys(ZERO_FRAME);
      if (!frame || Object.keys(frame).length !== 4) throw new Error('Expected four audio bands');
      const copy = {};
      for (const key of keys) copy[key] = unit(frame[key]);
      audio = copy;
      audioAt = now();
    },
    macro(index, value) {
      integer(index, 1, 8, 'macro index'); unit(value);
      if (macros[index - 1] !== value) dirtyMacros.add(index - 1);
      macros[index - 1] = value;
    },
    setName(value) {
      const next = assertName(value);
      if (next === name) return;
      name = next;
      // Take effect at the next 1 Hz hello; editing a name cannot flood registrations.
    },
    setPort(value) {
      const next = assertPort(value);
      if (next === port) return;
      if (started && !stopped && !blocked) send({ t: 'bye' }, true);
      port = next;
      clearRuntime();
      // A port edit must not clear a witnessed identity collision or a transport fault.
      if (!stopped && !blocked) { status('waiting'); tick(); }
    },
    newIdentity(value) {
      const next = assertId(value);
      if (next === id) return;
      if (started && !stopped && !blocked) send({ t: 'bye' }, true);
      id = next;
      blocked = false;
      clearRuntime();
      if (!stopped) { status('waiting'); tick(); }
    },
    fault,
    close() {
      if (stopped) return;
      stopped = true;
      if (started && !blocked) send({ t: 'bye' }, true);
      clearRuntime();
      status('closed');
    },
  };
}

module.exports = { createSession, HEARTBEAT_MS, ACK_TIMEOUT_MS, FEATURE_STALE_MS, MIDI_PER_SECOND };
