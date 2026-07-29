#!/usr/bin/env node
// Boot-parity smoke harness (deep-review INIT-04 S0).
//
// Boots the REAL server process (tsx src/main.ts) against a throwaway projects dir,
// connects one WS client, and reduces the observable startup behaviour to a stable
// JSON digest. Two runs must be byte-identical; any main.ts wiring change that
// perturbs startup must diff. The normalisation contract (what is retained vs
// redacted) lives in docs/plans/2026-07-26-deep-review/artifacts/smoke-normalisation.md
// and is summarised here:
//
// RETAINED (allow-list — anything not listed is NOT in the digest):
//   - stdout banner lines, with volatile substrings masked (<ip>, :<port>, PIN,
//     host token); LAN lines collapsed to a count.
//   - the ordered sequence of WS message types from connect ("messageOrder"),
//     binary frames as "binary", truncated once 3 stats frames are seen.
//   - the first `state` message's project/model/effects/output/showLibrary/
//     songLibrary/tunnel/osc/recovery SHAPES (recursive key structure, depth-limited).
//   - the first 3 `stats` frames' key sets (top-level, stats, voice).
//   - the ordered list of monitor events as {type,source,destination,label} —
//     both the live-received and the replayed stream.
// REDACTED (never in the digest): monitor ids/times/details, Date.now-derived ids
//   (snapshot stems `${Date.now()}-boot`), client ids `c<n>`, ports, hostnames,
//   IPs, randomUUIDs, mktemp absolute paths, host token, PIN, time/createdAt/
//   latencyMs/fps/timeMs/beat/uptimeMs and all other stats VALUES.
//
// Usage: node scripts/server-smoke.mjs --engine voice|legacy [--out file.json]
//                                      [--seed-corrupt]

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WS_PATH = '/ws';

// --- args -------------------------------------------------------------------
const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}
const engine = argValue('--engine');
const outPath = argValue('--out');
const seedCorrupt = args.includes('--seed-corrupt');
if (engine !== 'voice' && engine !== 'legacy') {
  console.error('usage: server-smoke.mjs --engine voice|legacy [--out file.json] [--seed-corrupt]');
  process.exit(2);
}

// --- helpers ----------------------------------------------------------------
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
    srv.on('error', rej);
  });
}

/** Recursive shape of a value: objects -> sorted key map, arrays -> length + first
 * element's shape, scalars -> typeof. Depth-limited so the digest stays stable and
 * readable while still catching a dropped/renamed field anywhere near the surface. */
function shapeOf(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (depth >= 4) return `array(${v.length})`;
    return { array: v.length, first: v.length ? shapeOf(v[0], depth + 1) : undefined };
  }
  if (typeof v === 'object') {
    if (depth >= 4) return `object{${Object.keys(v).sort().join(',')}}`;
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = shapeOf(v[k], depth + 1);
    return out;
  }
  return typeof v;
}

function maskBanner(line, { port, oscPort }) {
  return line
    .replaceAll(String(port), '<port>')
    .replaceAll(String(oscPort), '<oscPort>')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<ip>')
    .replace(/:(\d{2,5})\b/g, ':<port>')
    .replace(/PIN \d+/g, 'PIN <pin>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{32,64}\b/gi, '<token>');
}

/** Stable stringify: sorted keys at every level. */
function stableJson(v, indent = 2) {
  const sort = (x) => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      const o = {};
      for (const k of Object.keys(x).sort()) o[k] = sort(x[k]);
      return o;
    }
    return x;
  };
  // messageOrder / monitor arrays are ORDER-SIGNIFICANT and stay arrays (sort()
  // above only sorts object keys, never array elements).
  return JSON.stringify(sort(v), null, indent);
}

// --- boot -------------------------------------------------------------------
const port = await freePort();
const oscPort = await freePort();
const projectsDir = mkdtempSync(join(tmpdir(), 'ledrums-smoke-'));
if (seedCorrupt) {
  // Write a truncated live-project file so the boot-recovery ladder (S10) is exercised.
  writeFileSync(join(projectsDir, 'default.local.json'), '{"version": 1, "kit": {');
  mkdirSync(join(projectsDir, 'backups'), { recursive: true });
}

const env = { ...process.env };
// Strip anything that changes boot behaviour nondeterministically.
for (const k of Object.keys(env)) {
  if (k.startsWith('LEDRUMS_')) delete env[k];
}
env.PORT = String(port);
env.OSC_PORT = String(oscPort);
env.LEDRUMS_ENGINE = engine;
env.LEDRUMS_PROJECTS_DIR = projectsDir;
env.LEDRUMS_TELEMETRY = 'off';

const child = spawn(join(repoRoot, 'apps/server/node_modules/.bin/tsx'), ['src/main.ts'], {
  cwd: join(repoRoot, 'apps/server'),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stdoutLines = [];
const stderrLines = [];
let stdoutBuf = '';
let stderrBuf = '';
child.stdout.on('data', (d) => {
  stdoutBuf += d;
  const parts = stdoutBuf.split('\n');
  stdoutBuf = parts.pop();
  stdoutLines.push(...parts);
});
child.stderr.on('data', (d) => {
  stderrBuf += d;
  const parts = stderrBuf.split('\n');
  stderrBuf = parts.pop();
  stderrLines.push(...parts);
});

const deadline = Date.now() + 30_000;
async function waitFor(pred, what) {
  while (!pred()) {
    if (Date.now() > deadline) {
      await shutdown();
      console.error(`timeout waiting for ${what}`);
      console.error('--- stdout ---\n' + stdoutLines.join('\n'));
      console.error('--- stderr ---\n' + stderrLines.join('\n'));
      process.exit(1);
    }
    if (child.exitCode !== null && !pred()) {
      console.error(`server exited (${child.exitCode}) before ${what}`);
      console.error('--- stdout ---\n' + stdoutLines.join('\n'));
      console.error('--- stderr ---\n' + stderrLines.join('\n'));
      rmSync(projectsDir, { recursive: true, force: true });
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function shutdown() {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        r();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(t);
        r();
      });
    });
  }
}

await waitFor(() => stdoutLines.some((l) => l.includes('LEDrums server listening')), 'boot banner');
// Give the async surfaces (OSC bind status, snapshot rows) time to settle before the
// client connects, so the replayed monitor history is complete and stable.
await new Promise((r) => setTimeout(r, 500));

// --- WS capture -------------------------------------------------------------
const messageOrder = [];
const monitorEvents = [];
let stateShape = null;
const statsKeySets = [];
let statsSeen = 0;

const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
const wsDone = new Promise((res, rej) => {
  ws.addEventListener('error', (e) => rej(new Error(`ws error: ${e.message}`)));
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string') return; // binary preview frames race the stats clock — excluded
    const msg = JSON.parse(ev.data);
    // The high-rate streams (stats; binary handled above) interleave nondeterministically
    // with each other, so messageOrder records only the connect-handshake message types —
    // that is where the load-bearing presence-then-state-then-replay ordering lives.
    if (msg.t !== 'stats') messageOrder.push(msg.t);
    if (msg.t === 'monitor') {
      const { type, source, destination, label } = msg.event;
      monitorEvents.push({
        type,
        source: source ?? null,
        destination: destination ?? null,
        label: maskBanner(label, { port, oscPort }).replace(/udp:\d+/g, 'udp:<port>'),
      });
    } else if (msg.t === 'state' && stateShape === null) {
      stateShape = {
        project: shapeOf(msg.project, 2),
        model: shapeOf(msg.model, 2),
        effects: shapeOf(msg.effects, 2),
        projects: shapeOf(msg.projects, 2),
        output: shapeOf(msg.output, 1),
        showLibrary: shapeOf(msg.showLibrary, 1),
        songLibrary: shapeOf(msg.songLibrary, 1),
        tunnel: shapeOf(msg.tunnel, 1),
        osc: { ...shapeOf(msg.osc, 1), statusValue: msg.osc?.status ?? null },
        // Decision 8: whether this boot came through the recovery ladder is boot BEHAVIOUR, not
        // volatile detail — a clean boot must digest as null, so a regression that starts silently
        // claiming recovery (or stops reporting it) shows up as a baseline diff. The reason string
        // carries a filesystem-flavoured error message, so only its shape is retained.
        recovery: shapeOf(msg.recovery, 1),
      };
    } else if (msg.t === 'stats' && statsSeen < 3) {
      statsSeen += 1;
      statsKeySets.push({
        top: Object.keys(msg).sort(),
        stats: Object.keys(msg.stats ?? {}).sort(),
        voice: msg.voice ? Object.keys(msg.voice).sort() : null,
      });
    }
    if (statsSeen >= 3 && stateShape !== null) res();
  });
});
await Promise.race([
  wsDone,
  new Promise((_, rej) => setTimeout(() => rej(new Error('timeout waiting for state + 3 stats frames')), 15_000)),
]).catch(async (err) => {
  await shutdown();
  console.error(String(err));
  console.error('--- stderr ---\n' + stderrLines.join('\n'));
  process.exit(1);
});
// Drain any monitor rows still in flight after the last counted frame.
await new Promise((r) => setTimeout(r, 300));
ws.close();
await shutdown();

// --- digest -----------------------------------------------------------------
const bannerRaw = stdoutLines.filter((l) => l.trim().length > 0);
const lanCount = bannerRaw.filter((l) => l.trim().startsWith('LAN:')).length;
const banner = bannerRaw
  .filter((l) => !l.trim().startsWith('LAN:'))
  .map((l) => maskBanner(l, { port, oscPort }));

const digest = {
  harness: 'server-smoke/1',
  engine,
  seedCorrupt,
  banner,
  lanUrlCount: lanCount,
  messageOrder,
  state: stateShape,
  statsKeySets,
  monitor: monitorEvents,
};

const text = stableJson(digest) + '\n';
rmSync(projectsDir, { recursive: true, force: true });
if (outPath) {
  writeFileSync(outPath, text);
  console.log(`digest written to ${outPath}`);
} else {
  process.stdout.write(text);
}
