'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { installDevice } = require('./device-runtime.cjs');
const { createUdpTransport, DRAIN_TIMEOUT_MS } = require('./udp.cjs');
const { FakeClock, FakeSocket, flush } = require('./test-helpers.cjs');

// Execute the actual entrypoint with ONLY fake Max/process/socket/clock dependencies.
// No max-api installation, process signals/exits or OS sockets are used.
function harness() {
  const clock = new FakeClock();
  const socket = new FakeSocket();
  const handlers = new Map();
  const processHost = new EventEmitter();
  const exits = [];
  processHost.exit = (code) => { exits.push({ code, at: clock.time }); processHost.emit('exit', code); };
  const max = { addHandler: (name, fn) => handlers.set(name, fn), outlet: () => {} };
  runInNewContext(readFileSync(require.resolve('./max-bridge.cjs'), 'utf8'), {
    require(id) {
      if (id === 'max-api') return max;
      assert.equal(id, './device-runtime.cjs');
      return { installDevice: (host) => installDevice(host, {
        uuid: () => 'generated-uuid-1234', now: clock.now, every: clock.every, cancel: clock.cancel,
        transportFactory: (options) => createUdpTransport({ ...options, socketFactory: () => socket,
          setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }),
      }) };
    },
    process: processHost, setTimeout: clock.setTimeout,
  }, { filename: 'max-bridge.cjs' });
  return { clock, socket, handlers, processHost, exits,
    async start() { const starting = handlers.get('start')('midi'); socket.listen(); await starting; socket.complete(0); },
  };
}

test('Max explicit exit joins an already-running closebang drain, not a separate 100ms deadline', async () => {
  const h = harness(); await h.start();
  const drain = h.handlers.get('dispose')();
  h.clock.advance(80); h.processHost.emit('SIGTERM');
  h.clock.advance(100); await flush();
  assert.deepEqual(h.exits, [], 'process.exit must not cancel the accepted deferred bye');
  assert.equal(h.socket.closed, false);
  h.socket.complete(1); await drain; await flush();
  assert.deepEqual(h.exits, [{ code: 0, at: 180 }]);
  assert.equal(h.socket.cancelled.length, 0); assert.equal(h.socket.closeCalls, 1);
  assert.equal(h.clock.jobs.size, 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`Max repeated ${signal} cannot bypass the drain with default signal termination`, async () => {
    const h = harness(); await h.start();
    h.processHost.emit(signal);
    for (const repeat of [signal, signal, 'SIGINT', 'SIGTERM']) {
      assert.equal(h.processHost.listenerCount(repeat), 1);
      h.processHost.emit(repeat);
    }
    h.clock.advance(100); await flush();
    assert.deepEqual(h.exits, []);
    h.socket.complete(1); await flush();
    assert.deepEqual(h.exits, [{ code: 0, at: 100 }]);
    assert.equal(h.socket.sent.length, 2); assert.equal(h.socket.cancelled.length, 0);
    assert.equal(h.clock.jobs.size, 0);
  });
}

test('Max missing send callback exits only after the full shared drain budget', async () => {
  const h = harness(); await h.start();
  h.processHost.emit('SIGTERM');
  h.clock.advance(DRAIN_TIMEOUT_MS - 1); await flush();
  assert.deepEqual(h.exits, []); assert.equal(h.socket.closed, false);
  h.processHost.emit('SIGTERM'); h.clock.advance(1); await flush();
  assert.deepEqual(h.exits, [{ code: 0, at: DRAIN_TIMEOUT_MS }]);
  assert.equal(h.socket.closed, true); assert.equal(h.clock.jobs.size, 0);
});

test('Max signal while bind is pending joins its bounded disposal', async () => {
  const h = harness(); h.socket.refuseCloseWhileBinding = true;
  const starting = h.handlers.get('start')('midi');
  h.processHost.emit('SIGINT');
  h.clock.advance(DRAIN_TIMEOUT_MS - 1); await flush();
  assert.deepEqual(h.exits, []);
  h.clock.advance(1); await starting; await flush();
  assert.deepEqual(h.exits, [{ code: 0, at: DRAIN_TIMEOUT_MS }]);
  assert.equal(h.socket.unreferenced, true); assert.equal(h.socket.sent.length, 0);
  h.socket.listen(); assert.equal(h.socket.closed, true);
  assert.equal(h.clock.jobs.size, 0);
});
