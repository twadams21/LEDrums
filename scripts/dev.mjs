#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function loadEnvLocal() {
  const envPath = join(repoRoot, '.env.local');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

// Default dev to the voice engine (the current app). Explicit shell env and .env.local both
// still win (set after loadEnvLocal, and ??= only fills an unset value) — use LEDRUMS_ENGINE=legacy
// to run the legacy engine instead.
process.env.LEDRUMS_ENGINE ??= 'voice';

// ---- `pnpm dev --share`: expose the web server to the tailnet as HTTPS ----------------
// tailscale serve terminates TLS with the machine's MagicDNS cert and proxies to
// 127.0.0.1:<web-port>; only the web port is shared (WS rides vite's same-origin proxy).
// Tailnet-only — never funnel. Serve entries are machine-global, so both are torn down when
// this process exits; --share claims the machine's 443 slot for the duration of the run.
const share = process.argv.includes('--share');
const webPort = Number(process.env.LEDRUMS_WEB_PORT) || 5173;

function tailscaleBin() {
  const probe = spawnSync('tailscale', ['version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  if (!probe.error && probe.status === 0) return 'tailscale';
  const macApp = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  if (existsSync(macApp)) return macApp;
  return null;
}

function tailscale(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.error || r.status !== 0) {
    throw new Error(`tailscale ${args.join(' ')} failed: ${r.error?.message ?? r.stderr?.trim() ?? `exit ${r.status}`}`);
  }
  return r.stdout;
}

/** Start the two HTTPS proxies (443 + the web port itself) and print the tailnet URLs. */
function shareUp(bin) {
  tailscale(bin, ['serve', '--bg', String(webPort)]);
  tailscale(bin, ['serve', '--bg', `--https=${webPort}`, String(webPort)]);
  const status = JSON.parse(tailscale(bin, ['status', '--json']));
  const host = String(status?.Self?.DNSName ?? '').replace(/\.$/, '');
  console.log('');
  console.log('  Shared to the tailnet (HTTPS, tailnet-only):');
  console.log(`    https://${host}/`);
  console.log(`    https://${host}:${webPort}/`);
  console.log('  Proxies are removed when this process exits.');
  console.log('');
}

/** Best-effort teardown — a failed `off` must never mask the dev run's own exit status. */
function shareDown(bin) {
  for (const args of [['serve', '--https=443', 'off'], ['serve', `--https=${webPort}`, 'off']]) {
    try {
      tailscale(bin, args);
    } catch (err) {
      console.error(`[dev --share] cleanup warning: ${err.message}`);
    }
  }
}

let shareBin = null;
if (share) {
  shareBin = tailscaleBin();
  if (!shareBin) {
    console.error('[dev --share] tailscale CLI not found (PATH or /Applications/Tailscale.app) — cannot share.');
    process.exit(1);
  }
  // vite.config.ts reads this: bind 127.0.0.1 (the proxy target) with a strict port.
  process.env.LEDRUMS_WEB_SHARE = '1';
  try {
    shareUp(shareBin);
  } catch (err) {
    console.error(`[dev --share] ${err.message}`);
    process.exit(1);
  }
}

// Async spawn (not spawnSync) so signals aimed at only this process still tear the share
// down, with the child DETACHED into its own process group: pnpm ignores a plain SIGTERM to
// its own pid, so a forwarded signal must hit the whole group (pnpm + tsx + vite) to stop the
// stack. Teardown runs on the child's exit — covering Ctrl+C, `kill <this pid>`, and a
// crashing child alike. (win32: no process groups; shell:true + child.kill is the best we get.)
const win32 = process.platform === 'win32';
const child = spawn('pnpm', ['--parallel', '--filter', '@ledrums/server', '--filter', '@ledrums/web', 'run', 'dev'], {
  cwd: repoRoot,
  env: process.env,
  shell: win32,
  stdio: 'inherit',
  detached: !win32,
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      if (win32) child.kill(sig);
      else process.kill(-child.pid, sig);
    } catch {
      /* child already gone — its exit handler finishes up */
    }
  });
}

child.on('error', (err) => {
  if (share && shareBin) shareDown(shareBin);
  console.error(err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (share && shareBin) shareDown(shareBin);
  process.exit(signal ? 1 : (code ?? 1));
});
