'use strict';

// Foreign-client implementation of packages/protocol/src/track-input.ts (2026-09-14).
// Deliberately dependency-free: Max supplies max-api, not the LEDrums workspace/zod.
// This is JSON UDP, NOT OSC. Do not add fields without changing the server contract first.
const VERSION = 1;
const DEFAULT_PORT = 4322;
const MAX_BYTES = 2048;
const ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
const BANDS = Object.freeze(['level', 'bass', 'mids', 'highs']);
const FIELDS = Object.freeze({
  hello: ['name', 'kind'], bye: [], midi: ['note', 'velocity', 'on', 'channel'],
  cc: ['controller', 'value', 'channel'], audio: BANDS, macro: ['index', 'value'],
});
const ACK_REASONS = new Set([
  'duplicate-id', 'kind-changed', 'capacity', 'register-first', 'out-of-order',
  'rate-limit', 'wrong-kind', 'note-capacity',
]);

function assertId(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error('Identity must be 8–64 letters, digits, underscores or hyphens');
  }
  return value;
}
function assertName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Source name must be 1–80 printable characters');
  }
  return value.trim();
}
function assertKind(value) {
  if (value !== 'midi' && value !== 'audio') throw new Error('Kind must be midi or audio');
  return value;
}
function integer(value, lo, hi, label) {
  if (!Number.isSafeInteger(value) || value < lo || value > hi) throw new Error(`Invalid ${label}`);
  return value;
}
function assertPort(value) {
  // Never bind/send to a privileged service. No host field is accepted anywhere.
  return integer(value, 1024, 65535, 'UDP port (1024–65535)');
}
function unit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Value must be finite 0–1');
  }
  return value;
}
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new Error('Unexpected or missing packet fields');
  }
}
function validateMessage(message) {
  const fields = Object.hasOwn(FIELDS, message?.t) ? FIELDS[message.t] : undefined;
  if (!fields) throw new Error('Unsupported input message');
  exactKeys(message, ['t', ...fields]);
  if (message.t === 'hello') { assertName(message.name); assertKind(message.kind); }
  if (message.t === 'midi' || message.t === 'cc') integer(message.channel, 1, 16, 'MIDI channel');
  if (message.t === 'midi') {
    integer(message.note, 0, 127, 'MIDI note'); integer(message.velocity, 0, 127, 'MIDI velocity');
    if (typeof message.on !== 'boolean') throw new Error('MIDI on must be boolean');
  }
  if (message.t === 'cc') {
    integer(message.controller, 0, 127, 'MIDI controller'); integer(message.value, 0, 127, 'MIDI CC value');
  }
  if (message.t === 'audio') for (const band of BANDS) unit(message[band]);
  if (message.t === 'macro') { integer(message.index, 1, 8, 'macro index'); unit(message.value); }
}
function encodePacket(packet) {
  const { v, id, session, seq, ...message } = packet;
  if (v !== VERSION) throw new Error('Unsupported protocol version');
  assertId(id); assertId(session); integer(seq, 0, Number.MAX_SAFE_INTEGER, 'sequence');
  validateMessage(message);
  const data = Buffer.from(JSON.stringify(packet), 'utf8');
  if (data.length > MAX_BYTES) throw new Error('Packet exceeds 2048 bytes');
  return data;
}

/** One sequence for the entire runtime, including hello/data/bye and identity/port changes.
 * Failed local sends may create gaps; no old event is ever replayed to fill them. */
function createPacketWriter(session, initialSeq = 0) {
  assertId(session); integer(initialSeq, 0, Number.MAX_SAFE_INTEGER, 'sequence');
  let seq = initialSeq;
  return (id, message) => {
    const packet = { v: VERSION, id, session, seq, ...message };
    // Validate the body separately so callers cannot override envelope keys via a spread.
    validateMessage(message);
    const data = encodePacket(packet);
    seq += 1; // Exhaustion fails closed on the next call; never wraps.
    return { packet, data };
  };
}

/** Ack is the ONLY inbound message. No remote command, URL, project edit or shell dispatch. */
function decodeAck(data) {
  try {
    if (!(Buffer.isBuffer(data) || typeof data === 'string') || Buffer.byteLength(data) > MAX_BYTES) return null;
    const ack = JSON.parse(data.toString());
    exactKeys(ack, ack.ok === false
      ? ['v', 't', 'id', 'session', 'seq', 'ok', 'reason']
      : ['v', 't', 'id', 'session', 'seq', 'ok']);
    if (ack.v !== VERSION || ack.t !== 'ack' || typeof ack.ok !== 'boolean') return null;
    assertId(ack.id); assertId(ack.session); integer(ack.seq, 0, Number.MAX_SAFE_INTEGER, 'ack sequence');
    if (!ack.ok && !ACK_REASONS.has(ack.reason)) return null;
    return ack;
  } catch { return null; }
}

module.exports = {
  VERSION, DEFAULT_PORT, MAX_BYTES, ID_PATTERN, BANDS, assertId, assertName,
  assertKind, assertPort, integer, unit, encodePacket, createPacketWriter, decodeAck,
};
