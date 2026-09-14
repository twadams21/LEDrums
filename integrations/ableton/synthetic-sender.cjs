#!/usr/bin/env node
'use strict';

// Synthetic ONLY: never opens MIDI/audio devices, launches a host, or scans interfaces.
// Every socket is bound to / targets 127.0.0.1. The default production port is forbidden.
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { DEFAULT_PORT, assertPort, assertId, assertName } = require('./packets.cjs');
const { createSession } = require('./session.cjs');
const { createUdpTransport } = require('./udp.cjs');
const { PUBLISH_MS } = require('./audio.cjs');

const USAGE = `Usage: node integrations/ableton/synthetic-sender.cjs --port <nondefault-port> [options]
  --port <1024..65535>  REQUIRED; ${DEFAULT_PORT} is refused; destination is only 127.0.0.1
  --kind <both|midi|audio>  Default both (two independent source IDs/sockets)
  --id <id>            Default synthetic-track; both appends -midi / -audio
  --name <name>        Default Synthetic track; both appends MIDI / Audio
  --duration <seconds> Default 10; range 0.1..3600; sends bye on finish/SIGINT/SIGTERM
  --help              Print help without opening a socket
Example: node integrations/ableton/synthetic-sender.cjs --port 4395 --duration 60
Use ONLY with the isolated LEDrums dev server, output disabled. No project mutations are sent.`;

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const flags = new Set(['--port', '--kind', '--id', '--name', '--duration']);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!flags.has(flag) || Object.hasOwn(values, flag) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`Unknown, repeated or incomplete option: ${flag}`);
    }
    values[flag] = args[i + 1];
  }
  if (!values['--port'] || !/^\d+$/.test(values['--port'])) throw new Error('An explicit nondefault --port is required');
  const port = assertPort(Number(values['--port']));
  if (port === DEFAULT_PORT) throw new Error(`Refusing production port ${DEFAULT_PORT}; use the isolated dev bridge port`);
  const kind = values['--kind'] ?? 'both';
  if (!['both', 'midi', 'audio'].includes(kind)) throw new Error('Kind must be both, midi or audio');
  const id = assertId(values['--id'] ?? 'synthetic-track');
  const name = assertName(values['--name'] ?? 'Synthetic track');
  const duration = Number(values['--duration'] ?? '10');
  if (!Number.isFinite(duration) || duration < 0.1 || duration > 3600) throw new Error('Duration must be 0.1–3600 seconds');
  const kinds = kind === 'both' ? ['midi', 'audio'] : [kind];
  const sources = kinds.map((type) => ({
    kind: type, id: assertId(kind === 'both' ? `${id}-${type}` : id),
    name: assertName(kind === 'both' ? `${name} ${type === 'midi' ? 'MIDI' : 'Audio'}` : name),
  }));
  return { port, duration, sources };
}
function syntheticFrame(elapsedMs) {
  const wave = (period, phase = 0) => (1 + Math.sin(elapsedMs / period * Math.PI * 2 + phase)) / 2;
  return { level: 0.25 + 0.65 * wave(1800), bass: wave(2600), mids: wave(3300, 1), highs: wave(1200, 2) };
}

async function run(options, dependencies = {}) {
  const transportFactory = dependencies.transportFactory ?? createUdpTransport;
  const now = dependencies.now ?? (() => performance.now());
  const every = dependencies.every ?? setInterval;
  const cancel = dependencies.cancel ?? clearInterval;
  const processHost = dependencies.process ?? process;
  const logger = dependencies.console ?? console;
  const entries = [];
  const nonce = (dependencies.uuid ?? randomUUID)(); // Fresh runtime, stable IDs supplied by CLI.
  let closed = false;
  let timer;
  let finish;
  // This wakes startup/publication on a stop REQUEST. It is not the drain join: waiting
  // for run() from stop() while run() awaits this notification would deadlock.
  const done = new Promise((resolve) => { finish = resolve; });
  const connectedSources = new Set();
  function closeEntry(entry) {
    try { entry.client?.close(); } catch { processHost.exitCode = 1; }
    if (!entry.transport || entry.drain) return;
    try {
      entry.drain = Promise.resolve(entry.transport.close()).catch(() => { processHost.exitCode = 1; });
    } catch { processHost.exitCode = 1; entry.drain = Promise.resolve(); }
  }
  function stop(failed = false) {
    if (closed) return;
    closed = true;
    cancel(timer);
    for (const entry of entries) closeEntry(entry);
    if (failed || connectedSources.size !== options.sources.length) {
      processHost.exitCode = 1;
      if (!failed) logger.error('Not all synthetic sources registered; check the isolated dev bridge port/status.');
    }
    finish();
  }
  const signalStop = () => stop();
  // Keep handlers throughout the drain: a second signal must not take the default exit path.
  processHost.on('SIGINT', signalStop);
  processHost.on('SIGTERM', signalStop);
  try {
    for (const source of options.sources) {
      if (closed) break;
      const entry = { kind: source.kind, noteCycle: -1, held: false };
      entries.push(entry); // Own even a factory that reports an error synchronously during bind.
      entry.transport = transportFactory({
        onMessage: (data, peer) => entry.client?.receive(data, peer),
        onError: () => { if (!closed) { logger.error('Synthetic sender: UDP unavailable'); stop(true); } },
      });
      if (closed) break;
      entry.client = createSession({ ...source, session: nonce, port: options.port, now,
        send: (data, port) => entry.transport.send(data, port),
        onStatus: (state) => {
          logger.log(`${source.id}: ${state}`);
          if (state === 'connected') connectedSources.add(source.id);
          if (['duplicate-id', 'overload', 'transport-error'].includes(state)) {
            logger.error('Input stopped; use a deliberately different --id for a new source. No automatic takeover.');
            stop(true);
          }
        },
      });
      await Promise.race([entry.transport.ready, done]);
    }
    if (closed) return;
    const start = now();
    for (const { client } of entries) { if (closed) break; client.start(); }
    if (closed) return;
    logger.log(`Synthetic inputs -> 127.0.0.1:${options.port}; duration ${options.duration}s; no hardware access`);
    timer = every(() => {
      const elapsed = now() - start;
      if (elapsed >= options.duration * 1000) { stop(); return; }
      for (const entry of entries) {
        if (closed) break;
        const { client, kind } = entry;
        if (kind === 'audio') client.audio(syntheticFrame(elapsed));
        for (let i = 1; i <= 8; i++) client.macro(i, (1 + Math.sin(elapsed / 900 + i)) / 2);
        client.tick();
        if (kind !== 'midi' || !client.connected) { entry.held = false; continue; }
        const cycle = Math.floor(elapsed / 500);
        if (cycle !== entry.noteCycle) {
          if (entry.held) client.midi([0x90, 38, 0]);
          // Channel 1 snare, real-time interleaving; CC 74 is deliberately not recall CC 0.
          client.midi([0x90, 38, 0xf8, 100, 0xb0, 74, Math.round(syntheticFrame(elapsed).level * 127)]);
          entry.noteCycle = cycle;
          entry.held = true;
        } else if (entry.held && elapsed % 500 >= 120) {
          client.midi([0x80, 38, 0xf8, 64]); // Native release velocity retained on wire.
          entry.held = false;
        }
      }
    }, PUBLISH_MS);
    await done;
  } catch (error) {
    if (!closed) { logger.error(error.message); stop(true); }
  } finally {
    stop();
    // Revisit entries after startup unwinds: a synchronous factory error may have requested
    // stop before its transport was assigned. Join all drains concurrently, not source-by-source.
    for (const entry of entries) closeEntry(entry);
    await Promise.all(entries.map((entry) => entry.drain));
    processHost.removeListener('SIGINT', signalStop);
    processHost.removeListener('SIGTERM', signalStop);
  }
}
if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(USAGE);
    else run(options).catch((error) => { console.error(error.message); process.exitCode = 1; });
  } catch (error) { console.error(`${error.message}\n\n${USAGE}`); process.exitCode = 1; }
}
module.exports = { USAGE, parseArgs, syntheticFrame, run };
