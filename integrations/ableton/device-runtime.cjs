'use strict';

const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createSession } = require('./session.cjs');
const { createUdpTransport } = require('./udp.cjs');
const { DEFAULT_PORT, assertId, assertName, assertPort, assertKind, integer, unit } = require('./packets.cjs');
const { DEFAULT_SETTINGS, ZERO_FRAME, PUBLISH_MS, SETTING_RANGES, sanitizeSettings, analyzeStereoRms } = require('./audio.cjs');

const STATUS_TEXT = Object.freeze({
  waiting: 'Waiting for LEDrums on loopback', connected: 'Connected to LEDrums',
  'duplicate-id': 'Duplicate identity — click New identity, then save the Set',
  capacity: 'Input limit reached — remove an unused input',
  'kind-changed': 'Identity belongs to another device type — use New identity',
  'register-first': 'Waiting for registration', 'out-of-order': 'Registration order rejected — restart Node',
  'rate-limit': 'Registration rate limited', overload: 'Tap overloaded — input stopped; restart Node',
  'transport-error': 'UDP unavailable — input stopped; restart Node',
  'configuration-error': 'Invalid settings — input stopped; fix settings and restart Node',
  closed: 'Input stopped',
});

/** Host controls only. No Live API, filesystem persistence, desktop launch or remote execution.
 * All persistence belongs to the Max pattr/live parameter system; no machine token exists.
 * Dependencies are injectable so startup/restore/duplicate/dispose can be tested without Max. */
function installDevice(max, dependencies = {}) {
  const uuid = dependencies.uuid ?? randomUUID;
  const now = dependencies.now ?? (() => performance.now());
  const transportFactory = dependencies.transportFactory ?? createUdpTransport;
  const every = dependencies.every ?? setInterval;
  const cancel = dependencies.cancel ?? clearInterval;
  const nonce = uuid(); // Exactly once per Node lifetime, NOT per hello/live.thisdevice bang.
  let id = '';
  let name = '';
  let port = DEFAULT_PORT;
  let settings = { ...DEFAULT_SETTINGS };
  const macros = Array(8).fill(0);
  let client;
  let transport;
  let timer;
  let starting = false;
  let creatingTransport = false;
  let disposed = false;
  let disposal;
  let finishDisposal;
  let invalid = false;
  let dsp = false;
  let previous = { ...ZERO_FRAME };
  let audioAt = -Infinity;
  const report = (code) => max.outlet('status', STATUS_TEXT[code] ?? 'Input rejected — check settings');
  function handler(selector, fn) {
    max.addHandler(selector, (...args) => {
      if (disposed && selector !== 'dispose') return;
      try { return fn(...args); }
      catch {
        invalid = true;
        client?.fault('configuration-error');
        report('configuration-error');
      }
    });
  }
  handler('identity', (...atoms) => {
    const restored = atoms.join(' ').trim();
    if (restored) assertId(restored);
    if (!client && !starting) id = restored;
    else if (restored !== id) {
      // Preset restoration may change saved identity, but is never inferred to be a clone.
      // An empty restored value during a running session is refused, never silently minted.
      id = assertId(restored);
      client?.newIdentity(id);
    }
  });
  handler('name', (...atoms) => { name = assertName(atoms.join(' ')); client?.setName(name); });
  handler('port', (value) => { port = assertPort(value); client?.setPort(port); });
  handler('new-identity', () => {
    id = assertId(uuid());
    max.outlet('identity', id); // Writes pattr -> stored-only Blob -> Set/preset on save.
    client?.newIdentity(id);
  });
  handler('macro', (index, value) => {
    integer(index, 1, 8, 'macro index'); unit(value);
    macros[index - 1] = value;
    client?.macro(index, value);
  });
  handler('analysis', (key, value) => {
    if (!Object.hasOwn(SETTING_RANGES, key) || !Number.isFinite(value)) throw new Error('Invalid analysis setting');
    settings = sanitizeSettings({ ...settings, [key]: value });
  });
  handler('dsp', (enabled) => {
    dsp = enabled === 1;
    if (!dsp) {
      previous = { ...ZERO_FRAME };
      audioAt = -Infinity;
      if (client) client.audio(ZERO_FRAME);
    }
  });
  handler('rms', (...values) => {
    if (!client || !dsp) return;
    const time = now();
    const fresh = time - audioAt <= 500;
    previous = analyzeStereoRms(values, fresh ? previous : ZERO_FRAME, fresh ? time - audioAt : PUBLISH_MS, settings);
    audioAt = time;
    client.audio(previous);
  });
  handler('midi', (...bytes) => client?.midi(bytes));
  handler('start', (kind) => {
    assertKind(kind);
    if (client || starting || invalid) return; // Device-save/ready bangs are idempotent.
    starting = true;
    if (!id) { id = assertId(uuid()); max.outlet('identity', id); }
    creatingTransport = true;
    try {
      transport = transportFactory({
        onMessage: (data, peer) => client?.receive(data, peer),
        onError: () => { if (!disposed) { client?.fault('transport-error'); report('transport-error'); } },
      });
    } finally {
      creatingTransport = false;
      drainTransport(); // Own cleanup requested reentrantly before the factory returned.
    }
    return transport.ready.then(() => {
      if (disposed || invalid) return;
      client = createSession({
        id, session: nonce, kind, name: name || `LEDrums ${kind === 'midi' ? 'MIDI' : 'Audio'}`,
        port, now, send: (data, destination) => transport.send(data, destination), onStatus: report,
      });
      for (let i = 0; i < 8; i++) client.macro(i + 1, macros[i]);
      client.start();
      if (!disposed) timer = every(() => client.tick(), PUBLISH_MS);
    }).catch(() => { if (!disposed) report('transport-error'); });
  });
  function drainTransport() {
    if (!disposed || creatingTransport) return;
    try { Promise.resolve(transport?.close()).then(() => finishDisposal(), () => finishDisposal()); }
    catch { finishDisposal(); }
  }
  function dispose() {
    if (disposal) return disposal;
    disposed = true;
    // Publish the join before status/IO callbacks can re-enter disposal. Admission and
    // publication stop synchronously; only accepted local completions are awaited.
    disposal = new Promise((resolve) => { finishDisposal = resolve; });
    if (timer !== undefined) cancel(timer);
    try { client?.close(); }
    catch { /* Max's status outlet may already be gone; still dispose the socket. */ }
    drainTransport();
    return disposal; // Non-rejecting: safe to ignore from closebang, join from signal cleanup.
  }
  handler('dispose', dispose);
  max.outlet('ready'); // Patch waits for BOTH this and live.thisdevice before replaying state.
  return { dispose };
}

module.exports = { installDevice, STATUS_TEXT };
