'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSession, MIDI_PER_SECOND } = require('./session.cjs');
const { ZERO_FRAME } = require('./audio.cjs');
function harness(kind = 'midi', extra = {}) {
  let time = 0;
  const packets = [];
  const destinations = [];
  const states = [];
  const client = createSession({
    id: 'saved-source-01', session: 'runtime-session-01', name: 'Snare', kind,
    port: 4395, now: () => time,
    send: (data, port) => { packets.push(JSON.parse(data.toString())); destinations.push(port); return true; },
    onStatus: (state) => states.push(state), ...extra,
  });
  const ack = (ok = true, reason = 'duplicate-id', hello = packets.filter((p) => p.t === 'hello').at(-1), peer = { address: '127.0.0.1', port: 4395 }) => {
    const { id, session, seq } = hello;
    return client.receive(Buffer.from(JSON.stringify({ v: 1, t: 'ack', id, session, seq, ok, ...(!ok ? { reason } : {}) })), peer);
  };
  return { client, packets, destinations, states, ack, at: (value) => { time = value; client.tick(); } };
}

test('registration first, heartbeat lease, FIFO MIDI+CC, sequence shared with hello and bye', () => {
  const h = harness();
  h.client.midi([0x90, 38, 100]);
  assert.equal(h.packets.length, 0);
  h.client.start(); h.client.start();
  h.client.midi([0x90, 38, 100]);
  assert.deepEqual(h.packets.map((p) => p.t), ['hello']);
  h.ack();
  h.client.midi([0x90, 38, 0xf8, 100, 38, 0, 0xb0, 74, 127]);
  h.at(1000); h.ack(); h.client.close();
  assert.deepEqual(h.packets.map((p) => p.t), ['hello', 'midi', 'midi', 'cc', 'hello', 'bye']);
  assert.deepEqual(h.packets.map((p) => p.seq), [0, 1, 2, 3, 4, 5]);
  assert.equal(h.packets[2].on, false);
  assert.equal(h.client.state, 'closed');
});

test('collision latches despite late success, port/name edits or passage of lease time', () => {
  const h = harness(); h.client.start();
  const hello = h.packets[0];
  h.ack(false);
  const count = h.packets.length;
  assert.equal(h.client.state, 'duplicate-id');
  assert.equal(h.ack(true, undefined, hello), false);
  h.client.setName('Renamed'); h.client.setPort(4495);
  h.client.midi([0x90, 38, 100]); h.client.macro(1, 1);
  h.at(100_000);
  assert.equal(h.packets.length, count);
  h.client.newIdentity('replacement-id-01');
  assert.equal(h.packets.at(-1).id, 'replacement-id-01');
  assert.equal(h.packets.at(-1).session, hello.session);
  assert.equal(h.packets.at(-1).seq, hello.seq + 1);
  assert.equal(h.destinations.at(-1), 4495);
  assert.equal(h.packets.filter((p) => p.t === 'bye').length, 0, 'cannot bye the original claimant');
  assert.equal(h.ack(true, undefined, h.packets.at(-1), { address: '127.0.0.1', port: 4495 }), true);
  assert.equal(h.client.state, 'connected');
});

test('ack accepts only a recent outstanding hello from the exact endpoint/session', () => {
  const h = harness(); h.client.start();
  const hello = h.packets[0];
  assert.equal(h.ack(true, undefined, hello, { address: '127.0.0.2', port: 4395 }), false);
  assert.equal(h.ack(true, undefined, hello, { address: '127.0.0.1', port: 4322 }), false);
  for (const overrides of [{ session: 'old-session-01' }, { id: 'other-source-01' }, { seq: 9999 }]) {
    assert.equal(h.ack(true, undefined, { ...hello, ...overrides }), false);
  }
  h.at(4000);
  assert.equal(h.ack(true, undefined, hello), false);
  assert.equal(h.ack(), true);
  assert.equal(h.ack(), false, 'ack cannot be replayed');
});

test('late app startup/server restart reuses ID+nonce without replaying old notes', () => {
  const h = harness(); h.client.start();
  h.at(1000); h.at(2000); h.ack();
  h.client.midi([0x90, 38, 100]);
  h.at(5100); // No ACK for >3 seconds: stop data, continue bounded hello retries.
  assert.equal(h.client.connected, false);
  h.client.midi([0x90, 40, 100]);
  h.ack(); h.at(5200);
  assert.equal(h.client.connected, true);
  assert.equal(h.packets.filter((p) => p.t === 'midi').length, 1);
  assert.ok(h.packets.every((p) => p.id === 'saved-source-01' && p.session === 'runtime-session-01'));
  assert.deepEqual(h.packets.map((p) => p.seq), h.packets.map((_, i) => i));
});

test('pre-ACK and disconnected running status are parsed without replaying completed notes', () => {
  const h = harness(); h.client.start();
  h.client.midi([0x99, 36, 100]); // Completed before registration: discarded, not queued.
  h.ack(); h.client.midi([38, 90]);
  assert.deepEqual(h.packets.filter((p) => p.t === 'midi').map((p) => [p.note, p.channel]), [[38, 10]]);
  h.at(4000); h.client.midi([40, 100]); // Network down, raw stream still has running status.
  h.ack(); h.client.midi([42, 80]);
  assert.deepEqual(h.packets.filter((p) => p.t === 'midi').map((p) => p.note), [38, 42]);
});

test('name changes wait for heartbeat and port changes release the old endpoint first', () => {
  const h = harness(); h.client.start(); h.ack();
  for (let i = 0; i < 1000; i++) h.client.setName(`Snare ${i}`);
  assert.equal(h.packets.length, 1);
  h.at(1000); assert.equal(h.packets.at(-1).name, 'Snare 999');
  h.client.setPort(4495);
  assert.deepEqual(h.packets.slice(-2).map((p) => p.t), ['bye', 'hello']);
  assert.deepEqual(h.destinations.slice(-2), [4395, 4495]);
});

test('audio/macros coalesce at <=30Hz; all eight refresh and stale audio is not replayed', () => {
  const h = harness('audio'); h.client.start(); h.ack();
  for (let i = 0; i < 1000; i++) {
    h.client.audio({ ...ZERO_FRAME, level: i / 999 });
    for (let index = 1; index <= 8; index++) h.client.macro(index, i / 999);
  }
  h.at(0);
  assert.equal(h.packets.filter((p) => p.t === 'audio').length, 1);
  assert.equal(h.packets.at(-1).index, 8);
  assert.equal(h.packets.at(-1).value, 1);
  for (let time = 1; time < 500; time++) h.at(time);
  assert.ok(h.packets.filter((p) => p.t === 'audio').length <= 15);
  assert.equal(h.packets.filter((p) => p.t === 'macro').length, 8, 'unchanged macros are not flooded');
  h.at(1100); h.ack();
  assert.equal(h.packets.filter((p) => p.t === 'macro').length, 16);
  assert.ok(h.packets.filter((p) => p.t === 'audio').length <= 15, 'stopped snapshots must expire at server');
  assert.throws(() => h.client.audio({ ...ZERO_FRAME, level: Infinity }));
  assert.throws(() => h.client.audio({ ...ZERO_FRAME, timestamp: 0 }));
});

test('continuous updates plus MIDI fit below the server rate ceiling', () => {
  const h = harness(); h.client.start(); h.ack();
  for (let time = 0; time < 1000; time += 34) {
    for (let index = 1; index <= 8; index++) h.client.macro(index, time / 1000);
    h.client.midi([0x90, 38, 100, 38, 0]);
    h.at(time);
  }
  assert.equal(h.client.state, 'connected');
  assert.ok(h.packets.length <= 512);
  assert.ok(h.packets.filter((p) => p.t === 'macro').length <= 8 * 30);
  assert.throws(() => h.client.audio(ZERO_FRAME));
});

test('MIDI overload ends lease instead of dropping releases while keeping notes alive', () => {
  const h = harness(); h.client.start(); h.ack();
  for (let i = 0; i < MIDI_PER_SECOND + 1; i++) h.client.midi([0x90, 38, 100]);
  assert.equal(h.client.state, 'overload');
  assert.equal(h.packets.at(-1).t, 'bye');
  const count = h.packets.length;
  h.at(2000); h.client.midi([0x90, 38, 0]);
  assert.equal(h.packets.length, count);
});

test('send pressure/failure faults once even when the best-effort bye also fails', () => {
  let calls = 0;
  const h = harness('midi', { send: () => { calls++; return false; } });
  h.client.start();
  assert.equal(h.client.state, 'transport-error');
  assert.equal(calls, 2, 'hello and one best-effort bye; no recursive retry loop');
  h.at(2000); assert.equal(calls, 2);
});

test('new identity clears partial MIDI and audio but keeps user-authored macros', () => {
  const h = harness(); h.client.start(); h.ack(); h.client.midi([0x90, 38]);
  h.client.macro(1, 0.5); h.client.newIdentity('replacement-0001'); h.ack();
  h.client.midi([100]); h.at(1);
  assert.equal(h.packets.filter((p) => p.t === 'midi').length, 0);
  assert.equal(h.packets.find((p) => p.t === 'macro').value, 0.5);
});
