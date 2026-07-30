#!/usr/bin/env node
/* pin-throttle-probe — adversarial live-socket proof of the PIN admission throttle (INIT-05).
 *
 * WHY THIS EXISTS. The unit suite can prove `admitDecision` refuses a cooling peer and that the
 * connection handler forwards the escalation. It cannot prove that a REAL WebSocket, against a
 * REAL booted server, over a REAL socket, is actually refused — which is the exact failure mode
 * a review is meant to catch: a control that is green in tests and absent in the product. This
 * script is the non-model evidence, and it outranks any reading of the diff.
 *
 * ONE copy of the script serves BOTH halves of the before/after. Pointed at a baseline server
 * with `--url`, it produces the "before" observations (every attempt refused instantly, forever,
 * with no cooldown); pointed at HEAD it produces the "after". That is what `--url` is for: the
 * script does not need to exist at the baseline sha.
 *
 *   node scripts/pin-throttle-probe.mjs                              # boot HEAD's server, expect a throttle
 *   node scripts/pin-throttle-probe.mjs --url ws://127.0.0.1:4999 \
 *        --host-token <tok> --server-sha <sha> --expect none         # a baseline server
 *
 * Flags:
 *   --url <ws://host:port>  target an already-running server. Omitted → boot this worktree's
 *                           own server on a free port with a known PIN and host token.
 *   --pin <pin>             the room PIN the target enforces (default 4242).
 *   --host-token <tok>      the target's host-session token, for the bypass check.
 *   --server-sha <sha>      stamped into the artifact. Defaults to this worktree's HEAD, which
 *                           is only correct when the script booted the server itself.
 *   --expect throttled|none what the target should do. `throttled` (default) asserts the whole
 *                           control; `none` asserts the pre-change behaviour, so a baseline run
 *                           that silently DID throttle would fail loudly instead of being
 *                           written down as evidence of an absence.
 *   --attempts <n>          wrong-PIN dials in the flood (default 8; the allowance is 5).
 *   --out <file>            write the JSON verdict here as well as to stdout.
 *
 * Exits non-zero if any assertion for the chosen `--expect` fails. Never imported by the server,
 * and it takes no machine lock (its own port), so it does not contend with `pnpm gates`.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- args -------------------------------------------------------------------
function parseArgs(argv) {
  const out = { pin: '4242', expect: 'throttled', attempts: 8 };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const take = () => inline ?? argv[++i];
    switch (flag) {
      case '--url': out.url = take(); break;
      case '--pin': out.pin = take(); break;
      case '--host-token': out.hostToken = take(); break;
      case '--server-sha': out.serverSha = take(); break;
      case '--expect': out.expect = take(); break;
      case '--attempts': out.attempts = Number(take()); break;
      case '--out': out.out = take(); break;
      case '--help': case '-h': out.help = true; break;
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  if (!['throttled', 'none'].includes(out.expect)) throw new Error(`--expect must be throttled|none`);
  return out;
}

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- one connection attempt -------------------------------------------------
/**
 * Dial once and report what the server did. An admitted socket stays open, so "no close within
 * `settleMs` of opening" IS admission — we then close it ourselves so the probe never leaves
 * clients parked against a live server.
 */
function dial(base, query, { settleMs = 400, timeoutMs = 5_000 } = {}) {
  return new Promise((res) => {
    const started = Date.now();
    const url = `${base}/ws${query}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      res({ outcome: 'error', error: String(err), elapsedMs: Date.now() - started });
      return;
    }
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      clearTimeout(admitTimer);
      res({ ...v, elapsedMs: Date.now() - started });
    };
    let admitTimer;
    const hardTimeout = setTimeout(() => {
      try { ws.close(); } catch { /* already gone */ }
      finish({ outcome: 'timeout' });
    }, timeoutMs);

    ws.onopen = () => {
      // Refusals arrive as a close right after the upgrade; survive `settleMs` and we are in.
      admitTimer = setTimeout(() => {
        try { ws.close(1000, 'probe done'); } catch { /* already gone */ }
        finish({ outcome: 'admitted' });
      }, settleMs);
    };
    ws.onclose = (ev) => finish({ outcome: 'refused', code: ev.code, reason: ev.reason || '' });
    ws.onerror = () => {
      // The close event carries the detail; an error alone (server never upgraded) is its own case.
      if (!settled) setTimeout(() => finish({ outcome: 'error', error: 'socket error' }), 50);
    };
  });
}

// --- server under test ------------------------------------------------------
async function bootOwnServer() {
  const port = await freePort();
  const hostToken = 'p'.repeat(64);
  const child = spawn('pnpm', ['--filter', '@ledrums/server', 'start'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      LEDRUMS_PIN: '4242',
      LEDRUMS_HOST_TOKEN: hostToken,
      // Keep the probe's server off every shared side channel: no tunnel, and an OSC port of
      // its own so it cannot collide with a dev server or a sibling lane.
      LEDRUMS_TUNNEL: '',
      OSC_PORT: String(await freePort()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));

  // Readiness means the APP answered, not merely that a socket did something. A dial that
  // errors, times out, or closes 1006 means nothing is listening yet — treating that as "up"
  // silently pointed an entire probe run at a dead port and reported every check as a failure.
  const appAnswered = (r) => r.outcome === 'admitted' || (r.outcome === 'refused' && r.code >= 4000 && r.code <= 4999);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const probe = await dial(`ws://127.0.0.1:${port}`, `?hostToken=${hostToken}`, { settleMs: 150, timeoutMs: 1_000 });
    if (appAnswered(probe)) {
      // The readiness dial used the host bypass, so it charged no peer budget — the flood below
      // starts from a full allowance.
      return { base: `ws://127.0.0.1:${port}`, hostToken, pin: '4242', stop: () => child.kill('SIGTERM') };
    }
    await sleep(500);
  }
  child.kill('SIGKILL');
  throw new Error(`server did not come up on :${port} within 60s\n${log.join('')}`);
}

// --- the probe sequence -----------------------------------------------------
async function run(args) {
  const owned = args.url ? null : await bootOwnServer();
  const base = args.url ?? owned.base;
  const pin = owned?.pin ?? args.pin;
  const hostToken = args.hostToken ?? owned?.hostToken ?? null;

  const observations = {};
  try {
    // The host bypass must hold at EVERY point, so it is sampled before, during and after.
    observations.hostBefore = hostToken ? await dial(base, `?hostToken=${hostToken}`) : null;

    // The flood: N wrong-PIN dials from this one peer, in sequence.
    observations.wrongPinFlood = [];
    for (let i = 0; i < args.attempts; i++) {
      observations.wrongPinFlood.push(await dial(base, `?pin=0000`));
    }

    observations.hostDuring = hostToken ? await dial(base, `?hostToken=${hostToken}`) : null;

    // THE POINT OF THE WHOLE INITIATIVE: the CORRECT PIN, offered while the peer is cooling.
    // A server with no accounting admits it; a throttled one refuses without even comparing it.
    observations.correctDuringCooldown = await dial(base, `?pin=${pin}`);

    // Wait the server's own stated cooldown out (never a guess), then try the same PIN again.
    const stated = /retry in (\d+)s/.exec(observations.correctDuringCooldown.reason ?? '');
    const waitMs = stated ? Number(stated[1]) * 1_000 + 500 : 1_500;
    observations.waitedMs = waitMs;
    await sleep(waitMs);
    observations.correctAfterCooldown = await dial(base, `?pin=${pin}`);

    observations.hostAfter = hostToken ? await dial(base, `?hostToken=${hostToken}`) : null;
  } finally {
    owned?.stop();
  }
  return observations;
}

// --- assertions -------------------------------------------------------------
const WS_CLOSE_INVALID_PIN = 4401;
const WS_CLOSE_PIN_THROTTLED = 4429;

function assertions(o, expect) {
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass, detail });
  const flood = o.wrongPinFlood;

  check(
    'every wrong PIN is refused',
    flood.every((a) => a.outcome === 'refused'),
    flood.map((a) => `${a.outcome}${a.code ? `/${a.code}` : ''}`).join(' '),
  );
  check(
    'the first refusals are the invalid-pin code, not the throttled one',
    flood.slice(0, 5).every((a) => a.code === WS_CLOSE_INVALID_PIN),
    `codes ${flood.slice(0, 5).map((a) => a.code).join(',')}`,
  );
  if (o.hostBefore) {
    check(
      'the host-token bypass is admitted throughout, never throttled',
      [o.hostBefore, o.hostDuring, o.hostAfter].every((a) => a?.outcome === 'admitted'),
      [o.hostBefore, o.hostDuring, o.hostAfter].map((a) => a?.outcome).join(' '),
    );
  }

  if (expect === 'throttled') {
    const throttledInFlood = flood.filter((a) => a.code === WS_CLOSE_PIN_THROTTLED);
    check(
      'the allowance runs out: later dials close 4429, not 4401',
      throttledInFlood.length > 0,
      `${throttledInFlood.length} of ${flood.length} dials were throttled`,
    );
    check(
      'THE FINDING: the CORRECT PIN is refused during the cooldown',
      o.correctDuringCooldown.outcome === 'refused' && o.correctDuringCooldown.code === WS_CLOSE_PIN_THROTTLED,
      `${o.correctDuringCooldown.outcome} ${o.correctDuringCooldown.code ?? ''} "${o.correctDuringCooldown.reason ?? ''}"`,
    );
    check(
      'the refusal states a wait, so the client can be honest about it',
      /retry in \d+s/.test(o.correctDuringCooldown.reason ?? ''),
      `reason "${o.correctDuringCooldown.reason ?? ''}"`,
    );
    check(
      'NO PERMANENT LOCKOUT: the same correct PIN is admitted once the cooldown lapses',
      o.correctAfterCooldown.outcome === 'admitted',
      `${o.correctAfterCooldown.outcome} ${o.correctAfterCooldown.code ?? ''} after waiting ${o.waitedMs}ms`,
    );
  } else {
    check(
      'BASELINE: no dial is ever throttled — the 4429 code does not exist here',
      flood.every((a) => a.code !== WS_CLOSE_PIN_THROTTLED) &&
        o.correctDuringCooldown.code !== WS_CLOSE_PIN_THROTTLED,
      `codes ${flood.map((a) => a.code).join(',')}`,
    );
    check(
      'BASELINE: the correct PIN is admitted immediately, however many refusals preceded it',
      o.correctDuringCooldown.outcome === 'admitted',
      `${o.correctDuringCooldown.outcome} ${o.correctDuringCooldown.code ?? ''}`,
    );
    check(
      'BASELINE: refusals cost nothing — every dial is answered without a growing delay',
      Math.max(...flood.map((a) => a.elapsedMs)) < 1_000,
      `slowest refusal ${Math.max(...flood.map((a) => a.elapsedMs))}ms`,
    );
  }
  return checks;
}

// --- main -------------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`See the header of ${fileURLToPath(import.meta.url)}`);
  process.exit(0);
}

let serverSha = args.serverSha;
if (!serverSha) {
  try {
    serverSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot }).toString().trim();
  } catch {
    serverSha = 'unknown';
  }
}

const observations = await run(args);
const checks = assertions(observations, args.expect);
const ok = checks.every((c) => c.pass);
const report = {
  probe: 'pin-throttle-probe',
  expect: args.expect,
  serverSha,
  target: args.url ?? 'self-booted',
  ok,
  checks,
  observations,
};

const json = JSON.stringify(report, null, 2);
console.log(json);
if (args.out) {
  mkdirSync(dirname(resolve(repoRoot, args.out)), { recursive: true });
  writeFileSync(resolve(repoRoot, args.out), `${json}\n`);
}
for (const c of checks) console.error(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
process.exit(ok ? 0 : 1);
