#!/usr/bin/env node
/* Machine-wide mutex for full gate runs (typecheck + test).
 *
 * Parallel agents in sibling worktrees each run the full suite as their final
 * verification; unserialized, the vitest worker fleets exhaust memory and flake
 * each other (fetch-transform timeouts, timing assertions). This wrapper makes
 * full-suite runs queue machine-wide instead of sharing the machine:
 *
 *   node scripts/with-gate-lock.mjs <cmd> [args...]     (see: pnpm gates)
 *
 * The lock lives OUTSIDE the worktrees (~/.ledrums/locks/gates.lock) so every
 * checkout of this repo shares it. `mkdir` is the atomic acquire. A lock whose
 * owner process is dead, or older than STALE_MIN, is stolen — a crashed run
 * can't wedge the queue. Scoped dev-time runs (`vitest run <file>`) don't need
 * the lock; cap their workers instead (VITEST_MAX_FORKS / VITEST_MAX_THREADS,
 * which vitest reads natively — defaults are set here for the gated run).
 */
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOCK_DIR = join(homedir(), '.ledrums', 'locks', 'gates.lock');
const OWNER_FILE = join(LOCK_DIR, 'owner.json');
const STALE_MIN = 45;
const POLL_MS = 5000;

const cmd = process.argv[2];
const args = process.argv.slice(3);
if (!cmd) {
  console.error('usage: with-gate-lock.mjs <cmd> [args...]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryAcquire() {
  try {
    mkdirSync(LOCK_DIR, { recursive: false });
    writeFileSync(OWNER_FILE, JSON.stringify({ pid: process.pid, cwd: process.cwd(), started: new Date().toISOString() }));
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    return false;
  }
}

function ownerInfo() {
  try {
    return JSON.parse(readFileSync(OWNER_FILE, 'utf8'));
  } catch {
    return null; // mid-acquire or corrupt — treat as unknown, age check still applies
  }
}

function stealIfStale() {
  const owner = ownerInfo();
  const ageMin = owner?.started ? (Date.now() - Date.parse(owner.started)) / 60000 : Infinity;
  const dead = owner?.pid ? !pidAlive(owner.pid) : ageMin > 1; // no owner file for >1min = wreckage
  if (dead || ageMin > STALE_MIN) {
    console.error(`[gate-lock] stealing stale lock (owner pid ${owner?.pid ?? '?'} ${dead ? 'dead' : `running ${ageMin.toFixed(0)}min`})`);
    rmSync(LOCK_DIR, { recursive: true, force: true });
    return true;
  }
  return false;
}

function release() {
  const owner = ownerInfo();
  if (owner?.pid === process.pid) rmSync(LOCK_DIR, { recursive: true, force: true });
}

mkdirSync(join(homedir(), '.ledrums', 'locks'), { recursive: true });

let waitedMs = 0;
while (!tryAcquire()) {
  if (stealIfStale()) continue;
  if (waitedMs % 30000 === 0) {
    const owner = ownerInfo();
    console.error(`[gate-lock] waiting — held by pid ${owner?.pid ?? '?'} (${owner?.cwd ?? '?'}) since ${owner?.started ?? '?'}`);
  }
  await sleep(POLL_MS);
  waitedMs += POLL_MS;
}

process.on('exit', release);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    release();
    process.exit(130);
  });
}

// Bound the worker fleet even inside the lock — one full suite shouldn't own
// every core either. Respect explicit caller settings.
const env = { ...process.env };
env.VITEST_MAX_FORKS ??= '4';
env.VITEST_MAX_THREADS ??= '4';
// Tinypool errors if its default min (cpu-based, can exceed 4 on big machines)
// is above our max — pin the floors too.
env.VITEST_MIN_FORKS ??= '1';
env.VITEST_MIN_THREADS ??= '1';

console.error(`[gate-lock] acquired — running: ${cmd} ${args.join(' ')}`);
const child = spawn(cmd, args, { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
  release();
  process.exit(signal ? 130 : (code ?? 1));
});
