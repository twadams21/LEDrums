'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { installDevice } = require('./device-runtime.cjs');
const { createUdpTransport, DRAIN_TIMEOUT_MS } = require('./udp.cjs');
const { FakeClock, FakeSocket, flush } = require('./test-helpers.cjs');
function harness() {
  let time = 0;
  let serial = 0;
  let clock;
  let config;
  const handlers = new Map();
  const outlets = [];
  const packets = [];
  const transport = { ready: Promise.resolve(),
    send: (data, port) => { packets.push({ ...JSON.parse(data.toString()), port }); return true; },
    close: () => { transport.closed = true; },
  };
  const device = installDevice({
    addHandler: (name, fn) => handlers.set(name, fn), outlet: (...args) => outlets.push(args),
  }, {
    uuid: () => `generated-uuid-${++serial}`, now: () => time,
    every: (fn, ms) => { clock = fn; assert.equal(ms, 34); return 1; },
    cancel: () => { clock = undefined; },
    transportFactory: (options) => { config = options; return transport; },
  });
  const send = (selector, ...args) => handlers.get(selector)(...args);
  const ack = (ok = true) => {
    const hello = packets.filter((p) => p.t === 'hello').at(-1);
    config.onMessage(Buffer.from(JSON.stringify({
      v: 1, t: 'ack', id: hello.id, session: hello.session, seq: hello.seq, ok,
      ...(!ok ? { reason: 'duplicate-id' } : {}),
    })), { address: '127.0.0.1', port: hello.port });
  };
  return { send, ack, packets, outlets, transport, device, at: (value) => { time = value; clock?.(); }, get serial() { return serial; } };
}

test('cold restore owns saved identity; ready/save repetition never regenerates ID or session', async () => {
  const h = harness();
  assert.deepEqual(h.outlets, [['ready']]);
  assert.equal(h.packets.length, 0);
  h.send('identity', 'saved-uuid-1234'); h.send('name', 'Drum', 'rack'); h.send('port', 4395);
  await h.send('start', 'midi'); h.ack();
  await h.send('start', 'midi'); h.send('identity', 'saved-uuid-1234');
  h.at(1020);
  assert.equal(h.serial, 1, 'only the runtime nonce was generated');
  assert.equal(h.outlets.filter(([selector]) => selector === 'identity').length, 0);
  assert.ok(h.packets.every((packet) => packet.id === 'saved-uuid-1234' && packet.session === 'generated-uuid-1'));
  assert.equal(h.packets[0].name, 'Drum rack');
  assert.deepEqual(h.packets.filter((p) => p.t === 'hello').map((p) => p.seq), [0, 1]);
  h.device.dispose();
});

test('blank template generates exactly one saved UUID; New identity is explicit after duplicate', async () => {
  const h = harness(); h.send('identity', ''); await h.send('start', 'midi');
  assert.equal(h.serial, 2);
  assert.deepEqual(h.outlets.find(([selector]) => selector === 'identity'), ['identity', 'generated-uuid-2']);
  h.send('identity', 'generated-uuid-2'); h.ack(false); h.at(20_000);
  assert.equal(h.packets.length, 1);
  assert.ok(h.outlets.some(([selector, text]) => selector === 'status' && text.includes('Duplicate identity') && text.includes('New identity')));
  h.send('new-identity');
  assert.equal(h.packets.at(-1).id, 'generated-uuid-3');
  assert.equal(h.packets.at(-1).session, 'generated-uuid-1');
  assert.equal(h.packets.at(-1).seq, 1);
  h.device.dispose();
  assert.equal(h.packets.at(-1).t, 'bye');
  assert.equal(h.transport.closed, true);
});

test('invalid restored identity/name/port never falls back to a silently new identity', async () => {
  for (const [selector, args] of [['identity', ['bad/id']], ['name', ['']], ['port', [0]]]) {
    const h = harness(); h.send(selector, ...args); await h.send('start', 'audio');
    assert.equal(h.packets.length, 0);
    assert.equal(h.serial, 1);
    assert.ok(h.outlets.some(([kind, text]) => kind === 'status' && text.includes('Invalid settings')));
    h.device.dispose();
  }
});

test('audio settings, RMS sampling and DSP stop affect only telemetry', async () => {
  const h = harness(); h.send('identity', 'saved-audio-1234');
  h.send('analysis', 'attackMs', 0); h.send('analysis', 'releaseMs', 0);
  await h.send('start', 'audio'); h.ack();
  h.send('dsp', 1); h.send('rms', 1, 1, 0, 0, 0.01, 0.01, 0, 0); h.at(34);
  const frame = h.packets.find((packet) => packet.t === 'audio');
  assert.equal(frame.level, 1); assert.equal(frame.bass, 0); assert.equal(frame.highs, 0);
  assert.ok(frame.mids > 0 && frame.mids < 1);
  h.send('dsp', 0); h.send('rms', 1, 1, 1, 1, 1, 1, 1, 1); h.at(68);
  const last = h.packets.filter((packet) => packet.t === 'audio').at(-1);
  assert.equal(last.level, 0); assert.equal(last.mids, 0);
  h.device.dispose(); const count = h.packets.length;
  h.send('macro', 1, 1); h.at(2000);
  assert.equal(h.packets.length, count);
});

test('dispose joins accepted bye completion, including repeated Max cleanup and reentrant status cleanup', async () => {
  const clock = new FakeClock();
  const socket = new FakeSocket();
  const handlers = new Map();
  let reentrant;
  const device = installDevice({
    addHandler: (name, fn) => handlers.set(name, fn),
    outlet: (selector, text) => { if (selector === 'status' && text === 'Input stopped') reentrant = device.dispose(); },
  }, {
    uuid: () => 'generated-uuid-1234', now: clock.now, every: clock.every, cancel: clock.cancel,
    transportFactory: (options) => createUdpTransport({ ...options, socketFactory: () => socket,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }),
  });
  const starting = handlers.get('start')('midi');
  socket.listen(); await starting;
  socket.complete(0);
  const drain = handlers.get('dispose')();
  assert.ok(drain instanceof Promise, 'Max and signal cleanup must be able to join the transport drain');
  assert.equal(device.dispose(), drain); assert.equal(handlers.get('dispose')(), drain);
  assert.equal(reentrant, drain, 'publish the join before client.close can re-enter through status');
  const packets = socket.sent.map(({ data }) => JSON.parse(data));
  assert.deepEqual(packets.map(({ t, seq }) => [t, seq]), [['hello', 0], ['bye', 1]]);
  let joined = false; drain.then(() => { joined = true; });
  handlers.get('midi')(0x90, 38, 100); handlers.get('macro')(1, 1); handlers.get('start')('midi');
  clock.advance(100); await flush();
  assert.equal(joined, false); assert.equal(socket.closed, false); assert.equal(socket.sent.length, 2);
  assert.ok([...clock.jobs].every((job) => !job.repeat), 'publication stopped immediately');
  socket.complete(1); await drain;
  assert.equal(socket.closed, true); assert.equal(socket.cancelled.length, 0);
  assert.equal(clock.jobs.size, 0);
});

test('device cleanup joins timeout and late bind disposal without restarting the session', async () => {
  for (const bindFirst of [false, true]) {
    const clock = new FakeClock();
    const socket = new FakeSocket(); socket.refuseCloseWhileBinding = !bindFirst;
    const handlers = new Map();
    const device = installDevice({ addHandler: (name, fn) => handlers.set(name, fn), outlet: () => {} }, {
      uuid: () => 'generated-uuid-1234', now: clock.now, every: clock.every, cancel: clock.cancel,
      transportFactory: (options) => createUdpTransport({ ...options, socketFactory: () => socket,
        setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }),
    });
    const starting = handlers.get('start')('midi');
    if (bindFirst) { socket.listen(); await starting; }
    const drain = device.dispose();
    let joined = false; drain.then(() => { joined = true; });
    clock.advance(DRAIN_TIMEOUT_MS - 1); await flush();
    assert.equal(joined, false);
    clock.advance(1); await Promise.all([starting, drain]);
    if (!bindFirst) socket.listen();
    assert.equal(socket.closed, true);
    assert.deepEqual(socket.sent.map(({ data }) => JSON.parse(data).t), bindFirst ? ['hello', 'bye'] : []);
    assert.equal(clock.jobs.size, 0);
  }
});

test('cleanup requested during synchronous bind failure owns the transport returned afterward', async () => {
  const clock = new FakeClock();
  const socket = new FakeSocket(); socket.deferClose = true;
  socket.bind = () => { throw new Error('synthetic bind failure'); };
  const handlers = new Map();
  let drain;
  installDevice({
    addHandler: (name, fn) => handlers.set(name, fn),
    outlet: (_selector, text) => { if (text?.startsWith('UDP unavailable')) drain = handlers.get('dispose')(); },
  }, {
    uuid: () => 'generated-uuid-1234', now: clock.now, every: clock.every, cancel: clock.cancel,
    transportFactory: (options) => createUdpTransport({ ...options, socketFactory: () => socket,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }),
  });
  await handlers.get('start')('midi');
  let joined = false; drain.then(() => { joined = true; });
  await flush();
  assert.equal(joined, false, 'disposal cannot join an empty transport slot during factory construction');
  assert.equal(socket.closeCalls, 1);
  clock.advance(DRAIN_TIMEOUT_MS); await drain;
  assert.equal(socket.closed, true); assert.equal(socket.sent.length, 0); assert.equal(clock.jobs.size, 0);
});

test('cleanup re-entering through startup status cannot install a publication timer afterward', async () => {
  const clock = new FakeClock();
  const socket = new FakeSocket();
  const handlers = new Map();
  let drain;
  installDevice({
    addHandler: (name, fn) => handlers.set(name, fn),
    outlet: (_selector, text) => { if (text?.startsWith('Waiting for')) drain = handlers.get('dispose')(); },
  }, {
    uuid: () => 'generated-uuid-1234', now: clock.now, every: clock.every, cancel: clock.cancel,
    transportFactory: (options) => createUdpTransport({ ...options, socketFactory: () => socket,
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }),
  });
  const starting = handlers.get('start')('midi'); socket.listen(); await starting;
  assert.ok([...clock.jobs].every((job) => !job.repeat));
  socket.sent.forEach((_packet, index) => socket.complete(index)); await drain;
  assert.equal(clock.jobs.size, 0); assert.equal(socket.closed, true);
});

test('dispose before asynchronous transport readiness sends nothing later', async () => {
  const h = harness();
  let ready;
  h.transport.ready = new Promise((resolve) => { ready = resolve; });
  const starting = h.send('start', 'midi');
  h.device.dispose(); ready(); await starting;
  assert.equal(h.packets.length, 0);
  assert.equal(h.transport.closed, true);
});
