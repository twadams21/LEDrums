#!/usr/bin/env node
// Telemetry-health live-path probe (deep-review INIT-11 S5).
//
// apps/server/src/main.ts is a 0%-coverage composition root: nothing in `pnpm gates` executes the
// telemetry wiring block, so a green suite cannot tell you whether the ShipQueue health callbacks
// are actually connected to the Monitor bus. This probe is the evidence the suite cannot give.
//
// It boots the REAL server process against a throwaway projects dir and a throwaway HTTP stub
// standing in for the ingest Worker, drives real errors over a real WebSocket, and reads the real
// Monitor stream — then asserts the four things S5 claims:
//
//   PHASE A (stub: 401 on /ingest, 400 on /backups)
//     A1  exactly ONE "Error reporting blocked" system event — a stream would mean the transition
//         contract is broken, and an `error`-typed event would mean the recursion guard is broken.
//     A2  ZERO further POSTs to /ingest after it, EVEN WHILE new errors keep arriving. This is the
//         live-path twin of the ship-queue "a blocked queue does not ship on new enqueues" case,
//         and the only end-to-end proof that the enqueue guard is really wired.
//     A3  exactly ONE "Off-site backups dead-lettered" event, and the boot snapshot's bundle is
//         actually on disk in backups-outbox.jsonl.deadletter.jsonl.
//
//   PHASE B (fresh server, stub: 503 once on /ingest, then 200)
//     B1  exactly ONE "Error reporting retrying", then exactly ONE "Error reporting recovered" —
//         proving BOTH that the transition is emitted once rather than per attempt, and that the
//         success path really is the producer of the "recovered" label.
//
// DEVIATION from the plan's stated S5 check, which asked for "recovered" after a RESTART: that is
// unreachable by construction. `lastState` starts at 'ok' in a fresh process, so a successful ship
// on a restarted server is a non-transition and correctly emits nothing — a process that was never
// observed to be broken has nothing to recover from. Phase B gets the same label from the path that
// can actually produce it (retrying -> recovered inside one process), which is strictly more.
//
// Usage: node scripts/telemetry-health-probe.mjs [--keep]
// Runtime ~2.5 min: the queues flush on their real 30s cadence and back off 60s, and the probe
// waits on real timers rather than faking them — that is the point of a live-path check.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');

const freePort = () =>
  new Promise((res) => {
    const srv = createNetServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(ok, what, got) {
  if (ok) console.log(`  PASS  ${what}`);
  else {
    console.log(`  FAIL  ${what}${got === undefined ? '' : ` — got ${JSON.stringify(got)}`}`);
    failures.push(what);
  }
}

/** The throwaway ingest Worker: programmable status per route, with a request log. */
async function startStub() {
  const port = await freePort();
  const log = [];
  // Each entry is a status to return, shifted off in order; the last one repeats forever.
  const plan = { '/ingest': [200], '/backups': [200] };
  const srv = createServer((req, res) => {
    let bytes = 0;
    req.on('data', (c) => (bytes += c.length));
    req.on('end', () => {
      const path = new URL(req.url, 'http://x').pathname;
      const queue = plan[path] ?? [404];
      const status = queue.length > 1 ? queue.shift() : queue[0];
      log.push({ path, status, bytes, at: Date.now() });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(status === 200 ? { accepted: 1 } : { error: 'stub' }));
    });
  });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  return {
    port,
    log,
    set: (path, statuses) => (plan[path] = statuses),
    count: (path) => log.filter((e) => e.path === path).length,
    close: () => new Promise((r) => srv.close(r)),
  };
}

/** Boot the real server with telemetry pointed at the stub, and capture its Monitor stream. */
async function startServer(stubPort, label) {
  const port = await freePort();
  const oscPort = await freePort();
  const projectsDir = mkdtempSync(join(tmpdir(), 'ledrums-telem-'));
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('LEDRUMS_')) delete env[k];
  env.PORT = String(port);
  env.OSC_PORT = String(oscPort);
  env.LEDRUMS_PROJECTS_DIR = projectsDir;
  env.LEDRUMS_TELEMETRY = 'on';
  env.LEDRUMS_TELEMETRY_ENDPOINT = `http://127.0.0.1:${stubPort}/ingest`;
  env.LEDRUMS_TELEMETRY_TOKEN = 'probe-token';

  const child = spawn(join(repoRoot, 'apps/server/node_modules/.bin/tsx'), ['src/main.ts'], {
    cwd: join(repoRoot, 'apps/server'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));

  const deadline = Date.now() + 30_000;
  while (!out.join('').includes('LEDrums server listening')) {
    if (child.exitCode !== null || Date.now() > deadline) {
      console.error(`[${label}] server never booted:\n${out.join('')}`);
      process.exit(1);
    }
    await sleep(50);
  }
  await sleep(500); // let the async boot surfaces settle

  const events = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('ws failed to open')));
  });
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return;
    const msg = JSON.parse(ev.data);
    if (msg.t === 'monitor') events.push(msg.event);
  });

  return {
    projectsDir,
    events,
    /** Labels seen so far, telemetry-health only. */
    health: () => events.filter((e) => /^(Error reporting|Off-site backups) /.test(e.label)),
    /** Drive a real server-side error: an undecodable frame emits a `WebSocket decode error`. */
    driveError: (n) => ws.send(`{"t":"nonsense-${n}"`),
    stdout: () => out.join(''),
    async stop() {
      ws.close();
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await Promise.race([new Promise((r) => child.once('exit', r)), sleep(3000)]);
        if (child.exitCode === null) child.kill('SIGKILL');
      }
      if (!keep) rmSync(projectsDir, { recursive: true, force: true });
    },
  };
}

/** Wait until `pred()` or the deadline; returns whether it happened. */
async function waitFor(pred, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return true;
    await sleep(250);
  }
  return pred();
}

// --- Phase A: a rotated token blocks; a poison bundle dead-letters ----------------------------
console.log('\nPHASE A — /ingest 401 (rotated token), /backups 400 (poison bundle)');
const stub = await startStub();
stub.set('/ingest', [401]);
stub.set('/backups', [400]);
const a = await startServer(stub.port, 'A');

a.driveError(1);
a.driveError(2);
// The queues flush on their real 30s cadence; the boot snapshot is already in the backups queue.
const sawBlocked = await waitFor(() => a.health().some((e) => e.label === 'Error reporting blocked'), 60_000);
check(sawBlocked, 'A1 "Error reporting blocked" reaches the Monitor bus');

const blockedAt = stub.count('/ingest');
const deadLettered = a.health().filter((e) => e.label === 'Off-site backups dead-lettered');
check(
  a.health().filter((e) => e.label === 'Error reporting blocked').length === 1,
  'A1 exactly ONE blocked event, not a stream',
  a.health().filter((e) => e.label === 'Error reporting blocked').length,
);
const blockedEvent = a.health().find((e) => e.label === 'Error reporting blocked');
check(blockedEvent?.type === 'system', 'A1 the event is `system`, never `error` (no report recursion)', blockedEvent?.type);

// Keep the error stream running: without the enqueue guard this re-arms the flush timer forever.
for (let n = 3; n <= 6; n++) a.driveError(n);
await sleep(35_000);
check(stub.count('/ingest') === blockedAt, 'A2 ZERO further /ingest POSTs while new errors keep arriving', {
  atBlock: blockedAt,
  now: stub.count('/ingest'),
});
check(
  a.health().filter((e) => e.label === 'Error reporting blocked').length === 1,
  'A2 still exactly one blocked event after the extra errors',
);

check(deadLettered.length === 1, 'A3 exactly ONE "Off-site backups dead-lettered" event', deadLettered.length);
check(deadLettered[0]?.type === 'system', 'A3 the dead-letter event is `system`', deadLettered[0]?.type);
const deadPath = join(a.projectsDir, 'backups-outbox.jsonl.deadletter.jsonl');
const deadLines = existsSync(deadPath) ? readFileSync(deadPath, 'utf8').trim().split('\n') : [];
check(deadLines.length >= 1, 'A3 the poison bundle is parked on disk in the dead-letter file', deadLines.length);
check(
  deadLines.length > 0 && typeof JSON.parse(deadLines[0]).bundle === 'object',
  'A3 the dead-lettered line is the real backup record, forensically readable',
);
await a.stop();
await stub.close();

// --- Phase B: a transient outage retries once, then recovers ----------------------------------
console.log('\nPHASE B — /ingest 503 once (transient outage), then 200');
const stub2 = await startStub();
stub2.set('/ingest', [503, 200]);
stub2.set('/backups', [200]);
const b = await startServer(stub2.port, 'B');

b.driveError(1);
const sawRetrying = await waitFor(() => b.health().some((e) => e.label === 'Error reporting retrying'), 60_000);
check(sawRetrying, 'B1 "Error reporting retrying" on the transient failure');
// Backoff is 30s * 2^1 = 60s, so the recovering ship lands ~90s after boot.
const sawRecovered = await waitFor(() => b.health().some((e) => e.label === 'Error reporting recovered'), 90_000);
check(sawRecovered, 'B1 "Error reporting recovered" once the stub returns 200');
check(
  b.health().filter((e) => e.label === 'Error reporting retrying').length === 1,
  'B1 exactly ONE retrying event, not one per attempt',
  b.health().filter((e) => e.label === 'Error reporting retrying').length,
);
check(
  b.health().filter((e) => e.label === 'Error reporting recovered').length === 1,
  'B1 exactly ONE recovered event',
  b.health().filter((e) => e.label === 'Error reporting recovered').length,
);
await b.stop();
await stub2.close();

console.log(`\n${failures.length === 0 ? 'PROBE GREEN — all checks passed' : `PROBE RED — ${failures.length} failed:\n  ${failures.join('\n  ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
