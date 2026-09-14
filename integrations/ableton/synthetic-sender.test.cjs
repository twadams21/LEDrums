'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { parseArgs, syntheticFrame, run } = require('./synthetic-sender.cjs');
const { createUdpTransport, DRAIN_TIMEOUT_MS } = require('./udp.cjs');
const { FakeClock, FakeSocket, flush } = require('./test-helpers.cjs');

test('CLI refuses absent/default ports, host flags, malformed flags and unbounded durations', () => {
  for (const args of [
    [], ['--port', '4322'], ['--port', '0'], ['--port', '80'], ['--port', '65536'],
    ['--port', '4395', '--host', '192.168.1.1'], ['--port', '4395', '--host', 'localhost'],
    ['--port', '4395', '--port', '4495'], ['--port', '4395x'], ['--port'],
    ['--port', '4395', '--duration', 'Infinity'], ['--port', '4395', '--duration', '0'],
    ['--port', '4395', '--duration', '3601'], ['--port', '4395', '--kind', 'exec'],
    ['--port', '4395', '--id', 'x'.repeat(64)], // suffix would exceed schema for both
  ]) assert.throws(() => parseArgs(args), args.join(' '));
});

test('parent dev bridge 4395 gets two predictable independent source IDs', () => {
  assert.deepEqual(parseArgs(['--port', '4395', '--duration', '60']), {
    port: 4395, duration: 60, sources: [
      { kind: 'midi', id: 'synthetic-track-midi', name: 'Synthetic track MIDI' },
      { kind: 'audio', id: 'synthetic-track-audio', name: 'Synthetic track Audio' },
    ],
  });
  assert.deepEqual(parseArgs(['--port', '4395', '--kind', 'midi', '--id', 'saved-source-01', '--name', 'Snare']), {
    port: 4395, duration: 10, sources: [{ kind: 'midi', id: 'saved-source-01', name: 'Snare' }],
  });
  assert.deepEqual(parseArgs(['--help']), { help: true });
});

test('synthetic features are deterministic finite 0–1 data, with independently moving bands', () => {
  for (let time = 0; time <= 10_000; time += 34) {
    const frame = syntheticFrame(time);
    assert.deepEqual(frame, syntheticFrame(time));
    assert.deepEqual(Object.keys(frame), ['level', 'bass', 'mids', 'highs']);
    for (const value of Object.values(frame)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
  assert.notDeepEqual(syntheticFrame(0), syntheticFrame(1000));
});

function senderHarness(makeSocket = () => new FakeSocket()) {
  const clock = new FakeClock();
  const processHost = new EventEmitter(); processHost.exitCode = 0;
  const sockets = [];
  const logs = [];
  let finished = false;
  const options = parseArgs(['--port', '4395', '--duration', '0.1']);
  const done = run(options, {
    uuid: () => 'synthetic-runtime-1234', now: clock.now, every: clock.every, cancel: clock.cancel,
    process: processHost, console: { log: (line) => logs.push(line), error: (line) => logs.push(line) },
    transportFactory: (config) => {
      const socket = makeSocket(sockets.length); sockets.push(socket);
      return createUdpTransport({ ...config, socketFactory: () => socket,
        setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    },
  }).then(() => { finished = true; });
  const ack = (socket, ok = true) => {
    const hello = JSON.parse(socket.sent.find(({ data }) => JSON.parse(data).t === 'hello').data);
    socket.emit('message', Buffer.from(JSON.stringify({
      v: 1, t: 'ack', id: hello.id, session: hello.session, seq: hello.seq, ok,
      ...(!ok ? { reason: 'duplicate-id' } : {}),
    })), { address: '127.0.0.1', port: options.port });
  };
  return { clock, processHost, sockets, logs, done, ack, get finished() { return finished; },
    async start() {
      for (let index = 0; index < options.sources.length; index++) { sockets[index].listen(); await flush(); }
      for (const socket of sockets) { socket.complete(0); ack(socket); }
    },
  };
}
function completeAll(socket) { socket.sent.forEach((_packet, index) => socket.complete(index)); }
function types(socket) { return socket.sent.map(({ data }) => JSON.parse(data).t); }

for (const ending of ['duration', 'SIGINT', 'SIGTERM']) {
  test(`synthetic ${ending} waits for BOTH local drains and keeps repeated signal handlers until joined`, async () => {
    const h = senderHarness(); await h.start();
    if (ending === 'duration') h.clock.advance(102);
    else h.processHost.emit(ending);
    await flush();
    assert.equal(h.finished, false);
    assert.equal(h.sockets.length, 2);
    assert.ok(h.sockets.every((socket) => !socket.closed && types(socket).at(-1) === 'bye'));
    assert.ok([...h.clock.jobs].every((job) => !job.repeat && job.referenced));
    for (const signal of ['SIGINT', 'SIGINT', 'SIGTERM', 'SIGTERM']) {
      assert.equal(h.processHost.listenerCount(signal), 1);
      h.processHost.emit(signal);
    }
    completeAll(h.sockets[0]); await flush();
    assert.equal(h.finished, false, 'first source closing must not resolve the whole run');
    h.clock.advance(100); await flush();
    assert.equal(h.finished, false, 'the old Max-style 100ms exit must not bound this drain');
    completeAll(h.sockets[1]); await h.done;
    assert.ok(h.sockets.every((socket) => socket.closed && socket.cancelled.length === 0));
    assert.ok(h.sockets.every((socket) => types(socket).filter((t) => t === 'bye').length === 1));
    assert.equal(h.processHost.exitCode, 0);
    assert.equal(h.processHost.listenerCount('SIGINT'), 0); assert.equal(h.processHost.listenerCount('SIGTERM'), 0);
    assert.equal(h.clock.jobs.size, 0);
  });
}

test('synthetic never-completing sends time out concurrently without a run/stop join deadlock', async () => {
  const h = senderHarness(); await h.start();
  h.processHost.emit('SIGTERM');
  h.clock.advance(DRAIN_TIMEOUT_MS - 1); await flush();
  assert.equal(h.finished, false); assert.ok(h.sockets.every((socket) => !socket.closed));
  h.processHost.emit('SIGTERM');
  h.clock.advance(1); await h.done;
  assert.ok(h.sockets.every((socket) => socket.closed && socket.closeCalls === 1));
  assert.equal(h.clock.jobs.size, 0); assert.equal(h.processHost.listenerCount('SIGTERM'), 0);
});

test('synthetic signal during bind joins disposal without starting a second source', async () => {
  const h = senderHarness(() => {
    const socket = new FakeSocket(); socket.refuseCloseWhileBinding = true; return socket;
  });
  h.processHost.emit('SIGINT'); await flush();
  assert.equal(h.finished, false); assert.equal(h.sockets.length, 1);
  h.clock.advance(DRAIN_TIMEOUT_MS); await h.done;
  h.sockets[0].listen();
  assert.equal(h.sockets[0].closed, true); assert.deepEqual(types(h.sockets[0]), []);
  assert.equal(h.processHost.exitCode, 1, 'an unregistered run is still unsuccessful');
  assert.equal(h.clock.jobs.size, 0); assert.equal(h.processHost.listenerCount('SIGINT'), 0);
});

test('synthetic partial startup failure drains already-owned sources and closes the failing bind', async () => {
  const h = senderHarness();
  h.sockets[0].listen(); await flush();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].emit('error', new Error('synthetic bind failure'));
  await h.done;
  assert.ok(h.sockets.every((socket) => socket.closed));
  assert.ok(h.sockets.every((socket) => socket.sent.length === 0));
  assert.equal(h.processHost.exitCode, 1); assert.equal(h.clock.jobs.size, 0);
});

test('synchronous bind failure before factory return is owned and disposed', async () => {
  const h = senderHarness(() => {
    const socket = new FakeSocket(); socket.bind = () => { throw new Error('synthetic bind throw'); }; return socket;
  });
  await h.done;
  assert.equal(h.sockets.length, 1); assert.equal(h.sockets[0].closed, true);
  assert.equal(h.processHost.exitCode, 1); assert.equal(h.clock.jobs.size, 0);
});

test('synchronous startup send failure cannot restart publication after cleanup', async () => {
  const h = senderHarness(() => {
    const socket = new FakeSocket(); socket.send = () => { throw new Error('synthetic send throw'); }; return socket;
  });
  h.sockets[0].listen(); await flush(); h.sockets[1].listen();
  await h.done;
  assert.ok(h.sockets.every((socket) => socket.closed));
  assert.equal(h.processHost.exitCode, 1); assert.equal(h.clock.jobs.size, 0);
});

test('a deferred send error stops publication and joins outstanding work on every source', async () => {
  const h = senderHarness(); await h.start();
  h.clock.advance(34); // Both sources now have accepted data callbacks still outstanding.
  h.sockets[0].complete(1, new Error('synthetic deferred send failure'));
  await flush();
  assert.equal(h.finished, false); assert.equal(h.processHost.exitCode, 1);
  const counts = h.sockets.map((socket) => socket.sent.length);
  assert.ok(h.sockets.every((socket) => types(socket).at(-1) === 'bye' && !socket.closed));
  h.clock.advance(100); await flush();
  assert.deepEqual(h.sockets.map((socket) => socket.sent.length), counts, 'no new publication after failure');
  h.sockets.forEach(completeAll); await h.done;
  assert.ok(h.sockets.every((socket) => socket.closed && socket.cancelled.length === 0));
  assert.equal(h.clock.jobs.size, 0); assert.equal(h.processHost.listenerCount('SIGINT'), 0);
});

test('duplicate rejection never sends bye for that identity but joins the other source departure', async () => {
  const rejected = senderHarness();
  rejected.sockets[0].listen(); await flush(); rejected.sockets[1].listen(); await flush();
  const [collision, sibling] = rejected.sockets;
  collision.complete(0); sibling.complete(0);
  rejected.ack(collision, false); await flush();
  assert.deepEqual(types(collision), ['hello']); assert.deepEqual(types(sibling), ['hello', 'bye']);
  assert.equal(rejected.finished, false);
  sibling.complete(1); await rejected.done;
  assert.equal(rejected.processHost.exitCode, 1); assert.equal(rejected.clock.jobs.size, 0);
});
