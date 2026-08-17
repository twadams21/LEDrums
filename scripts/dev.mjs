#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
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

// ---- Port resolution -------------------------------------------------------------------
// The default ports (web 5173, server 4321) are routinely taken by another stack — a twux
// pool worktree, a stale dev run, ui-shot. Probe before starting and hop to the next free
// port instead of letting vite silently hop (leaving any tailnet proxy pointing at nothing)
// or the server crash EADDRINUSE. The chosen ports are exported so vite, its WS proxy, and
// the server all agree.
function portFree(port, host) {
  return new Promise((done) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', () => done(false));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => done(true)));
  });
}

async function pickPort(preferred, host, label) {
  for (let port = preferred; port < preferred + 50; port++) {
    if (await portFree(port, host)) {
      if (port !== preferred) console.log(`[dev] ${label} port ${preferred} is taken — using ${port}`);
      return port;
    }
  }
  throw new Error(`no free ${label} port in ${preferred}–${preferred + 49}`);
}

// Web probes IPv4 loopback (what vite binds under --share, and what tailscale serve dials);
// the server probes the wildcard it actually listens on.
const webPort = await pickPort(Number(process.env.LEDRUMS_WEB_PORT) || 5173, '127.0.0.1', 'web');
const serverPort = await pickPort(
  Number(process.env.PORT) || Number(process.env.LEDRUMS_WS_PORT) || 4321,
  undefined,
  'server',
);
process.env.LEDRUMS_WEB_PORT = String(webPort);
process.env.LEDRUMS_WS_PORT = String(serverPort);
process.env.PORT = String(serverPort);

// ---- `pnpm dev --share`: expose the web server to the tailnet as HTTPS ----------------
// tailscale serve terminates TLS with the machine's MagicDNS cert and proxies to
// 127.0.0.1:<web-port>; only the web port is shared (WS rides vite's same-origin proxy).
// Tailnet-only — never funnel. Serve entries are machine-global, so everything claimed here
// is torn down when this process exits. 443 (the clean URL) is a machine-wide singleton:
// it is claimed only when free, and only a claim made here is ever torn down — so two
// stacks can --share side by side without the second one stealing or destroying the
// first one's clean URL.
const share = process.argv.includes('--share');

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

/** Ports already claimed by serve entries (any owner, ours or another session's). */
function servePorts(bin) {
  const cfg = JSON.parse(tailscale(bin, ['serve', 'status', '--json']) || '{}');
  return new Set(Object.keys(cfg.TCP ?? {}).map(Number));
}

/**
 * Start the HTTPS proxies and print the tailnet URLs. Claims 443 (the clean URL) only if
 * no serve entry holds it, and always claims the web port itself. Returns the list of
 * https ports this run claimed, for teardown.
 */
function shareUp(bin) {
  const taken = servePorts(bin);
  const claimed = [];
  if (!taken.has(443)) {
    tailscale(bin, ['serve', '--bg', String(webPort)]);
    claimed.push(443);
  }
  tailscale(bin, ['serve', '--bg', `--https=${webPort}`, String(webPort)]);
  claimed.push(webPort);
  const status = JSON.parse(tailscale(bin, ['status', '--json']));
  const host = String(status?.Self?.DNSName ?? '').replace(/\.$/, '');
  console.log('');
  console.log('  Shared to the tailnet (HTTPS, tailnet-only):');
  if (claimed.includes(443)) console.log(`    https://${host}/`);
  else console.log(`    (443 already claimed by another share — use the port URL)`);
  console.log(`    https://${host}:${webPort}/`);
  console.log('  Proxies are removed when this process exits.');
  console.log('');
  return claimed;
}

/** Best-effort teardown — a failed `off` must never mask the dev run's own exit status. */
function shareDown(bin, claimed) {
  for (const port of claimed) {
    try {
      tailscale(bin, ['serve', `--https=${port}`, 'off']);
    } catch (err) {
      console.error(`[dev --share] cleanup warning: ${err.message}`);
    }
  }
}

let shareBin = null;
let sharePorts = [];
if (share) {
  shareBin = tailscaleBin();
  if (!shareBin) {
    console.error('[dev --share] tailscale CLI not found (PATH or /Applications/Tailscale.app) — cannot share.');
    process.exit(1);
  }
  // vite.config.ts reads this: bind 127.0.0.1 (the proxy target) with a strict port.
  process.env.LEDRUMS_WEB_SHARE = '1';
  try {
    sharePorts = shareUp(shareBin);
  } catch (err) {
    console.error(`[dev --share] ${err.message}`);
    process.exit(1);
  }
} else {
  console.log(`\n  Web UI: http://localhost:${webPort}/\n`);
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
  if (share && shareBin) shareDown(shareBin, sharePorts);
  console.error(err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (share && shareBin) shareDown(shareBin, sharePorts);
  process.exit(signal ? 1 : (code ?? 1));
});
