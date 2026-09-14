'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUdpTransport, MAX_PENDING_SENDS, DRAIN_TIMEOUT_MS } = require('./udp.cjs');
const { FakeClock, FakeSocket, flush } = require('./test-helpers.cjs');

function harness(socket = new FakeSocket()) {
  const clock = new FakeClock();
  const messages = [];
  const errors = [];
  const transport = createUdpTransport({
    socketFactory: () => socket, onMessage: (...args) => messages.push(args), onError: (error) => errors.push(error),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  return { socket, clock, messages, errors, transport };
}

test('accepted bye completes locally before the socket closes', async () => {
  const { socket, clock, transport } = harness();
  socket.listen(); await transport.ready;
  transport.send(Buffer.from('hello'), 4395); socket.complete(0);
  transport.send(Buffer.from('bye'), 4395);
  const drain = transport.close();
  assert.equal(socket.closed, false, 'close must not cancel deferred lookup for an accepted bye');
  assert.equal(transport.send(Buffer.from('late input'), 4395), false);
  assert.equal(transport.close(), drain, 'all callers join the same drain');
  let joined = false;
  drain.then(() => { joined = true; });
  await flush(); assert.equal(joined, false);
  socket.emit('listening');
  socket.emit('error', new Error('late socket notification'));
  assert.equal(socket.closed, false, 'socket events do not bypass outstanding local completions');
  socket.complete(1);
  await drain;
  assert.deepEqual(socket.completed.map(({ data }) => data.toString()), ['hello', 'bye']);
  assert.deepEqual(socket.cancelled, []);
  assert.equal(socket.closed, true);
  assert.equal(socket.closeCalls, 1);
  assert.equal(clock.jobs.size, 0);
});

test('socket boundary binds/sends literal loopback, bounds outbound work, ignores foreign replies', async () => {
  const h = harness();
  assert.deepEqual(h.socket.binding, { port: 0, address: '127.0.0.1' });
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), false);
  h.socket.listen(); await h.transport.ready;
  for (let i = 0; i < MAX_PENDING_SENDS; i++) assert.equal(h.transport.send(Buffer.from('{}'), 4395), true);
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), false);
  h.socket.complete(0);
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), true);
  assert.ok(h.socket.sent.every((packet) => packet.address === '127.0.0.1' && packet.port === 4395));
  assert.equal(h.transport.send(Buffer.alloc(2049), 4395), false);
  assert.throws(() => h.transport.send(Buffer.from('{}'), '4395'));
  h.socket.emit('message', Buffer.from('{}'), { address: '192.168.1.1', port: 4395 });
  h.socket.emit('message', Buffer.alloc(2049), { address: '127.0.0.1', port: 4395 });
  assert.equal(h.messages.length, 0);
  h.socket.emit('message', Buffer.from('{}'), { address: '127.0.0.1', port: 4395 });
  assert.equal(h.messages.length, 1);
  const drain = h.transport.close();
  h.socket.emit('message', Buffer.from('{}'), { address: '127.0.0.1', port: 4395 });
  assert.equal(h.messages.length, 1, 'replies stop immediately too');
  h.socket.sent[0].callback(); // Duplicate completion must not consume another send's slot.
  for (let i = 1; i < MAX_PENDING_SENDS; i++) h.socket.complete(i);
  assert.equal(h.socket.closed, false, 'every accepted send, not just bye/the first callback, drains');
  h.socket.complete(MAX_PENDING_SENDS);
  await drain;
  assert.equal(h.socket.closed, true);
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), false);
});

test('never-completing sends get one referenced deadline, not an indefinitely extended join', async () => {
  const h = harness(); h.socket.listen(); await h.transport.ready;
  h.transport.send(Buffer.from('bye'), 4395);
  const drain = h.transport.close();
  let joined = false;
  drain.then(() => { joined = true; });
  assert.equal(h.clock.jobs.size, 1);
  assert.equal([...h.clock.jobs][0].referenced, true, 'natural process exit must not preempt the drain');
  h.clock.advance(DRAIN_TIMEOUT_MS - 1); await flush();
  assert.equal(joined, false); assert.equal(h.socket.closed, false);
  assert.equal(h.transport.close(), drain);
  h.clock.advance(1); await drain;
  assert.equal(h.socket.closed, true); assert.equal(h.socket.closeCalls, 1);
  assert.equal(h.clock.jobs.size, 0);
  h.socket.sent[0].callback(new Error('late failure'));
  h.socket.sent[0].callback();
  assert.equal(h.socket.closeCalls, 1); assert.equal(h.errors.length, 0);
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), false);
});

test('missing close notification also has a bounded join', async () => {
  const socket = new FakeSocket(); socket.deferClose = true;
  const h = harness(socket); socket.listen(); await h.transport.ready;
  const drain = h.transport.close();
  let joined = false; drain.then(() => { joined = true; });
  await flush(); assert.equal(joined, false);
  h.clock.advance(DRAIN_TIMEOUT_MS); await drain;
  assert.equal(socket.closed, true); assert.equal(socket.closeCalls, 1);
  assert.equal(h.clock.jobs.size, 0);
  socket.emit('close');
  assert.equal(h.transport.close(), drain);
});

test('async and synchronous socket failures are observable, with no queue/retry accumulation', async () => {
  const h = harness(); h.socket.listen(); await h.transport.ready;
  h.transport.send(Buffer.from('{}'), 4395);
  h.socket.complete(0, new Error('synthetic send failure'));
  assert.equal(h.errors.length, 1);
  h.socket.send = () => { throw new Error('synthetic closed socket'); };
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), false);
  assert.equal(h.errors.length, 2);
  await h.transport.close();
  assert.equal(h.clock.jobs.size, 0, 'a synchronous throw is not a pending send');
});

test('synchronous callbacks and failed completions during drain settle exactly once', async () => {
  const h = harness(); h.socket.listen(); await h.transport.ready;
  h.socket.send = (_data, _port, _host, complete) => { complete(); complete(); };
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), true);
  h.socket.send = FakeSocket.prototype.send;
  h.transport.send(Buffer.from('bye'), 4395);
  const drain = h.transport.close();
  assert.equal(h.socket.closed, false);
  h.socket.complete(0, new Error('local send failed, not received'));
  await drain;
  assert.equal(h.socket.completed.length, 0, 'join is not a claim of successful receipt');
  assert.equal(h.clock.jobs.size, 0);
});

test('dispose during bind rejects readiness and prevents later sends', async () => {
  const h = harness();
  const rejected = assert.rejects(h.transport.ready, /closed/);
  const drain = h.transport.close();
  h.socket.listen();
  await Promise.all([rejected, drain]);
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), false);
  assert.equal(h.socket.closed, true); assert.equal(h.clock.jobs.size, 0);
});

test('a refused bind-pending close retries when listening arrives within the budget', async () => {
  const socket = new FakeSocket(); socket.refuseCloseWhileBinding = true;
  const h = harness(socket);
  const rejected = assert.rejects(h.transport.ready, /closed/);
  const drain = h.transport.close();
  let joined = false; drain.then(() => { joined = true; });
  h.clock.advance(DRAIN_TIMEOUT_MS - 1); await flush();
  assert.equal(joined, false); assert.equal(socket.closeCalls, 1);
  socket.listen();
  await Promise.all([rejected, drain]);
  assert.equal(socket.closed, true); assert.equal(socket.closeCalls, 2);
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), false);
  assert.equal(h.clock.jobs.size, 0);
});

test('a never-finishing bind times out but late listening still disposes the socket', async () => {
  const socket = new FakeSocket(); socket.refuseCloseWhileBinding = true;
  const h = harness(socket);
  // Deliberately ignore ready: a fire-and-forget dispose must not leak its rejection.
  const drain = h.transport.close();
  h.clock.advance(DRAIN_TIMEOUT_MS); await drain;
  assert.equal(socket.closed, false); assert.equal(socket.unreferenced, true);
  assert.equal(socket.closeCalls, 2); assert.equal(h.clock.jobs.size, 0);
  socket.listen();
  assert.equal(socket.closed, true); assert.equal(socket.closeCalls, 3);
  assert.equal(h.transport.close(), drain);
  assert.equal(h.transport.send(Buffer.from('{}'), 4395), false);
});

test('bind failures, including synchronous throws and errors after dispose, remain disposable', async () => {
  for (const synchronous of [false, true]) {
    const socket = new FakeSocket();
    if (synchronous) socket.bind = () => { throw new Error('synthetic bind failure'); };
    const h = harness(socket);
    const rejected = assert.rejects(h.transport.ready, /synthetic bind failure/);
    if (!synchronous) socket.emit('error', new Error('synthetic bind failure'));
    await rejected; await h.transport.close();
    assert.equal(h.errors.length, 1); assert.equal(socket.closed, true);
    assert.equal(h.clock.jobs.size, 0);
  }
  const socket = new FakeSocket(); socket.refuseCloseWhileBinding = true;
  const h = harness(socket);
  const drain = h.transport.close();
  socket.refuseCloseWhileBinding = false;
  socket.emit('error', new Error('late bind failure'));
  await drain;
  assert.equal(socket.closed, true); assert.equal(h.errors.length, 0);
  assert.equal(h.clock.jobs.size, 0);
});
