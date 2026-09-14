import test from 'node:test';
import assert from 'node:assert/strict';
import { runBenchmark } from './driver.mjs';
import { parseOptions, assertIsolatedUrl, assertStateSafe } from './options.mjs';
import { FakeClock, fakeSocketClass, optionsFixture, stateFixture, statsFixture } from './fixtures.test-support.mjs';

const presence = { t: 'presence', youAreEditor: true, clientCount: 1 };

function setup({ acknowledge = true, options = optionsFixture() } = {}) {
  const clock = new FakeClock();
  const state = stateFixture();
  let epoch = 0;
  const Socket = fakeSocketClass((ws, message) => {
    if (message.t === 'setShow' && acknowledge) {
      state.showRevision++;
      epoch = clock.now();
      ws.message(state);
    }
  });
  const aborter = new AbortController();
  const result = runBenchmark(options, { WebSocket: Socket, now: clock.now, timers: clock.timers, signal: aborter.signal });
  const ws = Socket.instance;
  const stats = () => statsFixture(clock.now(), epoch);
  const handshake = () => { ws.message(presence); ws.message(state); ws.message(stats()); };
  return { clock, ws, state, result, stats, handshake, aborter };
}

test('CLI requires consent, validates bounded durations, refuses default/remote/credential URLs', () => {
  const args = ['--url', 'ws://127.0.0.1:4399/ws', '--allow-mutations'];
  assert.equal(parseOptions(args).voices, 8);
  assert.equal(parseOptions(['--help']).help, true);
  for (const extra of [['--voices', '0'], ['--voices', '1.5'], ['--duration', 'Infinity'],
    ['--duration', '121'], ['--warmup', '-1'], ['--bogus'], ['--voices']]) {
    assert.throws(() => parseOptions([...args, ...extra]));
  }
  assert.throws(() => parseOptions(args.slice(0, 2)), /allow-mutations/);
  for (const url of ['ws://127.0.0.1:4321/ws', 'ws://127.0.0.1:5173/ws', 'ws://127.0.0.1/ws',
    'ws://localhost:4399/ws', 'ws://192.168.1.2:4399/ws', 'wss://127.0.0.1:4399/ws',
    'ws://127.0.0.1:4399/ws?pin=secret', 'ws://user:password@127.0.0.1:4399/ws', 'ws://127.0.0.1:4399/']) {
    assert.throws(() => assertIsolatedUrl(url));
  }
  assert.equal(assertIsolatedUrl('ws://[::1]:4399/ws'), 'ws://[::1]:4399/ws');
});

test('runner consent guard executes before constructing a connection', async () => {
  let called = false;
  await assert.rejects(runBenchmark({ ...optionsFixture(), allowMutations: false }, {
    WebSocket: class { constructor() { called = true; } },
  }), /allow-mutations/);
  assert.equal(called, false);
});

test('state safety rejects blackout/armed/missing output, external clock, tunnel, default OSC', () => {
  for (const mutate of [
    (s) => { s.output.state = 'blackout'; }, (s) => { s.project.output.state = 'armed'; },
    (s) => { delete s.output; }, (s) => { s.project.composition.transport.source = 'midiClock'; },
    (s) => { s.tunnel.status = 'live'; }, (s) => { s.osc.port = 9000; },
  ]) {
    const s = stateFixture(); mutate(s); assert.throws(() => assertStateSafe(s));
  }
});

test('missing timing never permits a mutation and timeout closes the socket', async () => {
  const h = setup({ options: { ...optionsFixture(), timeoutMs: 100 } });
  h.ws.message(presence); h.ws.message(h.state);
  const stats = h.stats(); delete stats.timing; h.ws.message(stats);
  await h.clock.advance(200);
  const result = await h.result;
  assert.equal(result.ok, false);
  assert.match(result.error, /stats.timing/);
  assert.equal(h.ws.sent.length, 0);
  assert.equal(h.ws.closed, true);
  assert.equal(h.clock.tasks.size, 0);
});

test('viewer/multiple clients fail without takeover, setShow or output setting', async () => {
  for (const other of [{ ...presence, youAreEditor: false }, { ...presence, clientCount: 2 }]) {
    const h = setup(); h.ws.message(other);
    assert.equal((await h.result).ok, false);
    assert.deepEqual(h.ws.sent, []);
    assert.equal(h.clock.tasks.size, 0);
  }
});

test('preflight waits for all three reports regardless of order', async () => {
  const h = setup();
  h.ws.message(h.stats()); h.ws.message(h.state);
  assert.deepEqual(h.ws.sent, []);
  h.ws.message(presence);
  assert.equal(h.ws.sent[0].t, 'setShow');
  h.aborter.abort();
  const result = await h.result;
  assert.equal(result.metadata.cleanup, 'cleared-ephemeral-runtime');
  assert.equal(h.clock.tasks.size, 0);
});

test('short warmup is refused before setShow', async () => {
  const h = setup({ options: { ...optionsFixture(), warmupMs: 0 } }); h.handshake();
  assert.match((await h.result).error, /warmup/);
  assert.deepEqual(h.ws.sent, []);
});

test('successful fake run uses only public synthetic inputs, records real snapshots, cleans up and closes', async () => {
  const h = setup(); h.handshake();
  const statsTimer = h.clock.timers.setInterval(() => { if (!h.ws.closed) h.ws.message(h.stats()); }, 500);
  const previewTimer = h.clock.timers.setInterval(() => { if (!h.ws.closed) h.ws.preview(); }, 34);
  await h.clock.advance(5100);
  h.clock.timers.clearInterval(statsTimer); h.clock.timers.clearInterval(previewTimer);
  const result = await h.result;
  assert.equal(result.ok, true, result.error);
  assert.equal(result.metadata.workload.requestedVoices, 8);
  assert.equal(result.metadata.host.cpu, 'synthetic test CPU');
  assert.ok(result.serverTiming.count > 0);
  assert.equal(result.serverTiming.windows[0].timing.renderDurationMs.p99, 1);
  assert.ok(result.preview.arrivalGapMs.p50 >= 34);
  assert.equal(result.observedVoiceCount.p50, 8);
  assert.ok(h.ws.sent.some((m) => m.t === 'midi'));
  assert.ok(h.ws.sent.some((m) => m.t === 'audioFeatures' && m.level > 0));
  assert.ok(h.ws.sent.every((m) => ['setShow', 'midi', 'audioFeatures'].includes(m.t)));
  assert.deepEqual(h.ws.sent.at(-1).show.graphs, {});
  assert.equal(result.metadata.cleanup, 'cleared-ephemeral-runtime');
  assert.equal(h.ws.closed, true);
  assert.equal(h.clock.tasks.size, 0);
});

test('100 Hz ordinary stats plus 1 Hz timing finish with retained metadata and non-overlapping windows', async () => {
  const h = setup(); h.handshake();
  const start = h.clock.now();
  const timer = h.clock.timers.setInterval(() => {
    if (h.ws.closed) return;
    const message = h.stats();
    if ((h.clock.now() - start) % 1000 !== 0) delete message.timing;
    h.ws.message(message); h.ws.preview();
  }, 10);
  await h.clock.advance(5100); h.clock.timers.clearInterval(timer);
  const result = await h.result;
  assert.equal(result.ok, true, result.error);
  assert.equal(result.metadata.host.cpu, 'synthetic test CPU');
  assert.equal(result.metadata.targetHz, 120);
  assert.ok(result.observedVoiceCount.count > 100);
  assert.ok(result.serverTiming.count > 0);
  const windows = result.serverTiming.windows;
  for (let i = 1; i < windows.length; i++) assert.ok(windows[i].timing.windowStartMs >= windows[i - 1].timing.windowEndMs);
  assert.equal(h.clock.tasks.size, 0);
});

test('ordinary stats between timing and presence do not erase the preflight snapshot', async () => {
  const h = setup(); h.ws.message(h.stats());
  const ordinary = h.stats(); delete ordinary.timing; h.ws.message(ordinary);
  h.ws.message(h.state); h.ws.message(presence);
  assert.equal(h.ws.sent[0].t, 'setShow');
  h.aborter.abort();
  const result = await h.result;
  assert.equal(result.metadata.host.cpu, 'synthetic test CPU');
  assert.equal(h.clock.tasks.size, 0);
});

test('continued ordinary stats do not hide missing timing and still enforce foreign-voice safety', async () => {
  const h = setup({ options: { ...optionsFixture(), timeoutMs: 100 } }); h.handshake();
  const timer = h.clock.timers.setInterval(() => {
    if (h.ws.closed) return;
    const message = h.stats(); delete message.timing; h.ws.message(message);
  }, 10);
  await h.clock.advance(200); h.clock.timers.clearInterval(timer);
  assert.match((await h.result).error, /stopped advancing/);
  assert.equal(h.clock.tasks.size, 0);
  const other = setup(); other.handshake();
  const message = other.stats(); delete message.timing;
  message.voice.voices[0].effectId = 'someone-elses-voice';
  const before = other.ws.sent.length; other.ws.message(message);
  assert.match((await other.result).error, /non-benchmark voice/);
  assert.equal(other.ws.sent.length, before);
});

test('selected track audio refuses before any mutation rather than measuring ignored WS audio', async () => {
  const h = setup(); h.state.project.inputMap.trackAudioInput = 'saved-audio-source'; h.handshake();
  assert.match((await h.result).error, /browser\/WS audio source/);
  assert.deepEqual(h.ws.sent, []);
  assert.equal(h.clock.tasks.size, 0);
});

test('output becoming armed stops immediately, with no attempt to disable or clean someone else\'s runtime', async () => {
  const h = setup(); h.handshake();
  const before = h.ws.sent.length;
  h.ws.message({ ...h.stats(), output: { state: 'armed' } });
  const result = await h.result;
  assert.match(result.error, /no longer disabled/);
  assert.equal(h.ws.sent.length, before);
  assert.equal(result.metadata.cleanup, 'skipped-unsafe-or-disconnected');
  assert.equal(h.clock.tasks.size, 0);
});

test('loss of isolation (peer, show, project or library) refuses further mutations, including cleanup', async () => {
  for (const change of [
    (h) => h.ws.message({ ...presence, clientCount: 2 }),
    (h) => h.ws.message({ ...h.state, showRevision: 99 }),
    (h) => h.ws.message({ ...h.state, showLibrary: { version: 2, data: {} } }),
    (h) => h.ws.message({ ...h.state, project: { ...h.state.project, name: 'external edit' } }),
  ]) {
    const h = setup(); h.handshake();
    const before = h.ws.sent.length; change(h);
    assert.equal((await h.result).ok, false);
    assert.equal(h.ws.sent.length, before);
    assert.equal(h.ws.closed, true);
  }
});

test('disconnect, server error and abort settle rather than leave a background client', async () => {
  for (const fail of [(h) => h.ws.close(), (h) => h.ws.message({ t: 'error', message: 'rejected' }), (h) => h.aborter.abort()]) {
    const h = setup(); h.handshake(); fail(h);
    assert.equal((await h.result).ok, false);
    assert.equal(h.ws.closed, true);
    assert.equal(h.clock.tasks.size, 0);
  }
});

test('stale timing and client send backlog fail boundedly instead of silently measuring old data', async () => {
  const h = setup({ options: { ...optionsFixture(), timeoutMs: 100 } }); h.handshake();
  await h.clock.advance(200);
  assert.match((await h.result).error, /stopped advancing/);
  assert.equal(h.clock.tasks.size, 0);

  const queued = setup(); queued.handshake();
  queued.ws.bufferedAmount = 2 * 1024 * 1024;
  await queued.clock.advance(50);
  assert.match((await queued.result).error, /backlog/);
  assert.equal(queued.clock.tasks.size, 0);
});

test('late client emission skips missed sequence indices without a catch-up message burst', async () => {
  const h = setup(); h.handshake();
  // Invoke just the driver poll after an injected pause; no timer sweep or real waiting.
  h.clock.at += 2500;
  [...h.clock.tasks.values()][0].fn();
  h.aborter.abort();
  const result = await h.result;
  assert.equal(result.metadata.emissions.midiBursts, 2); // indices 0 and 2, not 0/1/2
  assert.equal(result.metadata.emissions.skippedMidiBursts, 1);
  assert.equal(result.metadata.emissions.audioFrames, 2); // indices 0 and 75
  assert.equal(result.metadata.emissions.skippedAudioFrames, 74);
  assert.equal(h.clock.tasks.size, 0);
});

test('missing setShow ack and missing cleanup ack are bounded', async () => {
  const h = setup({ acknowledge: false, options: { ...optionsFixture(), timeoutMs: 100 } }); h.handshake();
  await h.clock.advance(1200);
  const result = await h.result;
  assert.match(result.error, /adopting/);
  assert.equal(result.metadata.cleanup, 'unconfirmed-timeout');
  assert.equal(h.ws.closed, true);
  assert.equal(h.clock.tasks.size, 0);
});
