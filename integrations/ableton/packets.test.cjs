'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertId, assertName, assertPort, createPacketWriter, encodePacket, decodeAck, MAX_BYTES } = require('./packets.cjs');
const ID = 'saved-source-0001';
const SESSION = 'runtime-session-0001';

test('exact parent wire variants share one monotonically increasing envelope', () => {
  const write = createPacketWriter(SESSION);
  const messages = [
    { t: 'hello', name: 'Snare', kind: 'midi' },
    { t: 'midi', note: 38, velocity: 101, on: true, channel: 10 },
    { t: 'midi', note: 38, velocity: 64, on: false, channel: 10 },
    { t: 'cc', controller: 74, value: 53, channel: 2 },
    { t: 'hello', name: 'Renamed', kind: 'midi' },
    { t: 'audio', level: 0, bass: 1, mids: 0.25, highs: 0.75 },
    { t: 'macro', index: 8, value: 0.5 },
    { t: 'bye' },
  ];
  messages.forEach((message, seq) => {
    const expected = { v: 1, id: ID, session: SESSION, seq, ...message };
    const encoded = write(ID, message);
    assert.deepEqual(encoded.packet, expected);
    assert.deepEqual(JSON.parse(encoded.data.toString('utf8')), expected);
    assert.ok(encoded.data.length <= 2048);
  });
});

test('no envelope override, arbitrary command, field coercion, or extra metadata', () => {
  const write = createPacketWriter(SESSION);
  const bad = [
    { t: 'hello', name: 'Snare', kind: 'midi', capabilities: ['midi'] },
    { t: 'bye', seq: 0 }, { t: 'bye', v: 2 }, { t: 'bye', id: 'other-id' },
    { t: 'setProject', project: {} }, { t: 'exec', command: 'anything' }, { t: '__proto__' },
    { t: 'midi', note: 128, velocity: 10, channel: 1, on: true },
    { t: 'midi', note: 1, velocity: 10, channel: 0, on: true },
    { t: 'midi', note: 1, velocity: 10, channel: 17, on: true },
    { t: 'midi', note: 1, velocity: 10, channel: 1, on: 1 },
    { t: 'cc', controller: 74, value: '10', channel: 1 },
    { t: 'audio', level: NaN, bass: 0, mids: 0, highs: 0 },
    { t: 'audio', level: Infinity, bass: 0, mids: 0, highs: 0 },
    { t: 'audio', level: 0, bass: -0.1, mids: 0, highs: 0 },
    { t: 'macro', index: 0, value: 0 }, { t: 'macro', index: 9, value: 0 },
    { t: 'macro', index: 1, value: 1.001 },
  ];
  for (const message of bad) assert.throws(() => write(ID, message));
  assert.equal(write(ID, { t: 'bye' }).packet.seq, 0, 'rejected bodies consume no sequence');
});

test('identity/name/port bounds; Unicode names serialize in UTF-8', () => {
  for (const id of ['12345678', 'a'.repeat(64), '0_A-b_C-d']) assert.equal(assertId(id), id);
  for (const id of ['', 'short', 'a'.repeat(65), '../identity', 'source/id', 12345678]) assert.throws(() => assertId(id));
  assert.equal(assertName('  打鼓 · Snare  '), '打鼓 · Snare');
  for (const name of ['', '   ', 'x'.repeat(81), 'bad\nname']) assert.throws(() => assertName(name));
  for (const port of [1024, 4322, 4395, 65535]) assert.equal(assertPort(port), port);
  for (const port of [0, 1023, 65536, '4395', 4395.5, NaN]) assert.throws(() => assertPort(port));
  const result = createPacketWriter(SESSION)(ID, { t: 'hello', name: '打鼓'.repeat(40), kind: 'audio' });
  assert.ok(result.data.length < MAX_BYTES);
});

test('sequence exhaustion refuses to wrap or reuse an earlier sequence', () => {
  const write = createPacketWriter(SESSION, Number.MAX_SAFE_INTEGER);
  assert.equal(write(ID, { t: 'bye' }).packet.seq, Number.MAX_SAFE_INTEGER);
  assert.throws(() => write(ID, { t: 'bye' }));
  assert.throws(() => encodePacket({ v: 2, id: ID, session: SESSION, seq: 0, t: 'bye' }));
});

test('only exact bounded registration acks are decoded; no reflected remote commands', () => {
  const ack = { v: 1, t: 'ack', id: ID, session: SESSION, seq: 1, ok: true };
  const rejected = { ...ack, ok: false, reason: 'duplicate-id' };
  assert.deepEqual(decodeAck(Buffer.from(JSON.stringify(ack))), ack);
  assert.deepEqual(decodeAck(JSON.stringify(rejected)), rejected);
  for (const value of [
    { ...ack, v: 2 }, { ...ack, seq: -1 }, { ...ack, seq: '1' }, { ...ack, ok: 1 },
    { ...ack, command: 'start' }, { ...ack, reason: 'duplicate-id' },
    { ...rejected, reason: 'arbitrary remote text' }, { ...ack, t: 'setProject' }, null, [],
  ]) assert.equal(decodeAck(JSON.stringify(value)), null);
  assert.equal(decodeAck('not json'), null);
  assert.equal(decodeAck(`${' '.repeat(MAX_BYTES)}${JSON.stringify(ack)}`), null);
});
