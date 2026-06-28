// Tauri `beforeBuildCommand` / `beforeDevCommand` entry point.
//
// Stages everything the Rust shell bundles + spawns at runtime:
//   1. Build the web UI (`pnpm --filter @ledrums/web build`).
//   2. Stage apps/web/dist → apps/desktop/web-dist (a stable resource path referenced by
//      tauri.conf `bundle.resources`; copied so the bundler never reaches across packages).
//   3. Build the server sidecar binary (delegates to build-sidecar.mjs).
//   4. Verify a cloudflared resource is present; warn (don't fail) if missing so dev builds
//      still work — the app degrades to local/LAN access without a tunnel.
//
// Set PREPARE_SKIP_SIDECAR=1 to skip the (slow) SEA step when iterating on Rust/UI only —
// the previously built binary in src-tauri/binaries is reused.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const repoRoot = resolve(desktopDir, '..', '..');
const webDist = join(repoRoot, 'apps', 'web', 'dist');
const stagedWeb = join(desktopDir, 'web-dist');
const cloudflaredDir = join(desktopDir, 'src-tauri', 'cloudflared');

function run(cmd, args, opts = {}) {
  console.log(`[prepare] $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, ...opts });
}

// 1. Build the web UI.
run('pnpm', ['--filter', '@ledrums/web', 'build']);

// 2. Stage the web dist next to the Tauri crate so `bundle.resources` can reference it.
if (!existsSync(join(webDist, 'index.html'))) {
  throw new Error(`[prepare] web build produced no index.html at ${webDist}`);
}
rmSync(stagedWeb, { recursive: true, force: true });
mkdirSync(stagedWeb, { recursive: true });
cpSync(webDist, stagedWeb, { recursive: true });
console.log(`[prepare] staged web dist → ${stagedWeb}`);

// 3. Build the sidecar binary (unless explicitly skipped).
if (process.env.PREPARE_SKIP_SIDECAR === '1') {
  console.log('[prepare] PREPARE_SKIP_SIDECAR=1 — reusing existing sidecar binary');
} else {
  run('node', [join(desktopDir, 'scripts', 'build-sidecar.mjs')], { cwd: desktopDir });
}

// 4. Cloudflared resource presence check (warn-only — graceful degradation by design).
const hasCloudflared =
  existsSync(cloudflaredDir) && readdirSync(cloudflaredDir).some((f) => f.startsWith('cloudflared'));
if (!hasCloudflared) {
  console.warn(
    '[prepare] WARNING: no cloudflared binary in src-tauri/cloudflared — the app will run ' +
      'with local/LAN access only (no public tunnel). Run `pnpm --filter @ledrums/desktop ' +
      'fetch:cloudflared` to add it.',
  );
} else {
  console.log('[prepare] cloudflared resource present');
}

console.log('[prepare] done');
