// Build the self-contained server sidecar binary for the Tauri desktop app.
//
// Pipeline:
//   1. esbuild-bundle apps/server/src/main.ts (+ workspace deps @ledrums/core|io|protocol,
//      ws, zod) into a single CommonJS file. ws's OPTIONAL native deps (bufferutil,
//      utf-8-validate) are marked external so the pure-JS fallback is used — no node-gyp,
//      no native addons (a project non-negotiable).
//   2. Wrap that bundle as a Node Single Executable Application (SEA) using Node's built-in
//      tooling (`node --experimental-sea-config` + postject) so the result runs with NO Node
//      installed on the user's machine.
//   3. Emit it under src-tauri/binaries/ named for Tauri's sidecar convention:
//      `ledrums-server-<target-triple>` (e.g. ledrums-server-x86_64-apple-darwin).
//
// Usage:
//   node scripts/build-sidecar.mjs [--triple <triple>] [--bundle-only]
//
//   --triple       override the auto-detected Rust host triple (for cross-target naming)
//   --bundle-only  stop after the esbuild bundle (skip SEA) — useful when Node SEA tooling
//                  is unavailable; the orchestrator can finish packaging from the .cjs.
//
// Producing a binary for ANOTHER target triple requires building ON that platform (Node SEA
// copies the *host* node executable; it is not a cross-compiler). Run this script on each
// target OS/arch, or in that platform's CI, passing --triple if auto-detection is wrong.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const repoRoot = resolve(desktopDir, '..', '..');
const serverEntry = join(repoRoot, 'apps', 'server', 'src', 'main.ts');
const sidecarDir = join(desktopDir, 'sidecar'); // intermediate build artifacts
const binariesDir = join(desktopDir, 'src-tauri', 'binaries'); // Tauri externalBin location
const bundleFile = join(sidecarDir, 'server.cjs');

const args = process.argv.slice(2);
const bundleOnly = args.includes('--bundle-only');
const tripleArg = args.includes('--triple') ? args[args.indexOf('--triple') + 1] : undefined;

/** Detect the Rust host target triple — Tauri names sidecars `<name>-<triple>`. */
function hostTriple() {
  if (tripleArg) return tripleArg;
  try {
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
    const m = /^host:\s*(.+)$/m.exec(out);
    if (m) return m[1].trim();
  } catch {
    /* rustc absent — fall through to the manual mapping */
  }
  // Fallback mapping from Node's platform/arch when rustc is unavailable.
  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const arch = archMap[process.arch] ?? process.arch;
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  return `${arch}-unknown-linux-gnu`;
}

const triple = hostTriple();
const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const outBinary = join(binariesDir, `ledrums-server-${triple}${exeSuffix}`);

mkdirSync(sidecarDir, { recursive: true });
mkdirSync(binariesDir, { recursive: true });

// --- 1. esbuild bundle ------------------------------------------------------

console.log('[sidecar] bundling server with esbuild…');
const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [serverEntry],
  outfile: bundleFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // Optional native acceleration deps of `ws` — keep them external so the bundle requires only
  // the pure-JS fallback (no node-gyp / native addons). dgram/http/crypto are node built-ins
  // and are left as require()s by platform:node.
  external: ['bufferutil', 'utf-8-validate'],
  // The CJS output format has no `import.meta`, but the server's path-resolution helpers use
  // `import.meta.url` (to anchor the in-repo defaults). Polyfill it to the bundle's own file URL
  // so module load never throws — the desktop shell always overrides those paths via env anyway,
  // but the module-level `here` constant must still evaluate.
  banner: { js: "const __ledrumsImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__ledrumsImportMetaUrl' },
  logLevel: 'info',
  legalComments: 'none',
});
console.log(`[sidecar] bundle written: ${bundleFile}`);

if (bundleOnly) {
  console.log('[sidecar] --bundle-only set; skipping SEA. Run with: node ' + bundleFile);
  process.exit(0);
}

// --- 2. Node SEA wrap -------------------------------------------------------

// The Node executable copied as the SEA base IS the runtime that ships in the sidecar, and its
// version decides SEA/postject compatibility. Node "Current" (odd-major) lines such as v25 hit a
// postject Mach-O bug on macOS — the produced binary crashes at launch with
// `dyld: unsupported thread-local, larger than 4GB`. Even-major LTS lines (v20/22/24) are fine.
// So we PIN a known-good LTS and use it for the SEA steps regardless of the dev's active Node:
// `pnpm tauri build` then works on any machine (incl. a Node-25 default) and produces reproducible
// artifacts. Override the version with LEDRUMS_SEA_NODE_VERSION.
const PINNED_NODE = (process.env.LEDRUMS_SEA_NODE_VERSION || '22.23.1').replace(/^v/, '');

/**
 * Resolve a Node executable to use as the SEA base. Uses the active Node when it is already on the
 * pinned line; otherwise downloads + verifies + caches the pinned LTS from nodejs.org (host
 * platform/arch). Falls back to the active Node only when it is an even-major LTS and the download
 * is unavailable (offline CI); refuses to produce a known-broken binary on a Current line.
 */
async function resolveBuildNode() {
  const wantMajor = PINNED_NODE.split('.')[0];
  const curMajor = process.versions.node.split('.')[0];
  if (curMajor === wantMajor) return process.execPath; // already on the pinned line

  const isWin = process.platform === 'win32';
  const archMap = { x64: 'x64', arm64: 'arm64' };
  const arch = archMap[process.arch] ?? process.arch;
  const platform = isWin ? 'win' : process.platform; // darwin | linux | win
  const name = `node-v${PINNED_NODE}-${platform}-${arch}`;
  const ext = isWin ? 'zip' : 'tar.gz';
  const cacheRoot = join(desktopDir, '.node-pin');
  const nodeBin = isWin ? join(cacheRoot, name, 'node.exe') : join(cacheRoot, name, 'bin', 'node');

  if (existsSync(nodeBin)) {
    console.log(`[sidecar] using cached pinned Node v${PINNED_NODE} as the SEA base`);
    return nodeBin;
  }

  try {
    mkdirSync(cacheRoot, { recursive: true });
    const base = `https://nodejs.org/dist/v${PINNED_NODE}`;
    console.log(
      `[sidecar] active Node is v${process.versions.node}; fetching pinned LTS v${PINNED_NODE} ` +
        `(${name}.${ext}) for a reproducible, postject-safe SEA base…`,
    );
    const sumsRes = await fetch(`${base}/SHASUMS256.txt`);
    if (!sumsRes.ok) throw new Error(`SHASUMS256 fetch ${sumsRes.status}`);
    const want = (await sumsRes.text())
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .find(([, f]) => f === `${name}.${ext}`)?.[0];
    if (!want) throw new Error(`no checksum entry for ${name}.${ext}`);

    const tarRes = await fetch(`${base}/${name}.${ext}`);
    if (!tarRes.ok) throw new Error(`archive fetch ${tarRes.status}`);
    const buf = Buffer.from(await tarRes.arrayBuffer());
    const got = createHash('sha256').update(buf).digest('hex');
    if (got !== want) throw new Error(`checksum mismatch (${got} != ${want})`);

    const archive = join(cacheRoot, `${name}.${ext}`);
    writeFileSync(archive, buf);
    // tar (GNU ≥1.15 + bsdtar) auto-detects gzip on extract, and bsdtar handles .zip too.
    const ex = spawnSync('tar', ['-xf', archive, '-C', cacheRoot], { stdio: 'inherit' });
    rmSync(archive, { force: true });
    if (ex.status !== 0 || !existsSync(nodeBin)) throw new Error('extraction failed');
    console.log(`[sidecar] pinned Node ready: ${nodeBin}`);
    return nodeBin;
  } catch (e) {
    const major = Number(curMajor);
    if (major >= 20 && major % 2 === 0) {
      console.warn(
        `[sidecar] could not fetch pinned Node (${e.message}); falling back to the active Node ` +
          `v${process.versions.node} — an even-major LTS line, so SEA should still work.`,
      );
      return process.execPath;
    }
    throw new Error(
      `Cannot build a working SEA: active Node v${process.versions.node} is a non-LTS line known to ` +
        `crash via postject on macOS, and fetching the pinned LTS v${PINNED_NODE} failed (${e.message}). ` +
        `Fix: run on an LTS Node (even major ≥20), or set LEDRUMS_SEA_NODE_VERSION with network access.`,
    );
  }
}

const buildNode = await resolveBuildNode();

const seaConfigFile = join(sidecarDir, 'sea-config.json');
const blobFile = join(sidecarDir, 'server.blob');
// useCodeCache/useSnapshot are intentionally OFF: code cache is tied to the exact Node build
// and snapshotting a server that opens sockets at import time is fragile — portability first.
writeFileSync(
  seaConfigFile,
  JSON.stringify(
    { main: bundleFile, output: blobFile, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false },
    null,
    2,
  ),
);

console.log('[sidecar] generating SEA blob…');
execFileSync(buildNode, ['--experimental-sea-config', seaConfigFile], { stdio: 'inherit' });

// Copy the pinned node executable as the binary base, then inject the blob into it.
rmSync(outBinary, { force: true });
copyFileSync(buildNode, outBinary);
chmodSync(outBinary, 0o755);

// macOS/Windows-signed node binaries must have their signature removed before postject mutates
// the executable, then (mac) be re-signed ad-hoc afterwards.
const isMac = process.platform === 'darwin';
if (isMac) {
  try {
    execFileSync('codesign', ['--remove-signature', outBinary], { stdio: 'inherit' });
  } catch {
    console.warn('[sidecar] codesign --remove-signature failed (continuing)');
  }
}

console.log('[sidecar] injecting SEA blob with postject…');
const { inject } = await import('postject');
await inject(outBinary, 'NODE_SEA_BLOB', readFileSync(blobFile), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  machoSegmentName: isMac ? 'NODE_SEA' : undefined,
});

if (isMac) {
  try {
    execFileSync('codesign', ['--sign', '-', outBinary], { stdio: 'inherit' });
  } catch {
    console.warn('[sidecar] codesign --sign - failed (binary may need manual ad-hoc signing)');
  }
}

chmodSync(outBinary, 0o755);
console.log(`[sidecar] done → ${outBinary}`);

// --- 3. self-diagnosing smoke test -----------------------------------------
//
// Boot the produced binary briefly to confirm the SEA actually loads. This catches the known
// macOS dyld TLV failure ("unsupported thread-local, larger than 4GB") that postject's Mach-O
// injection can produce on some Node builds — surfacing it loudly instead of shipping a binary
// that crashes on launch. Non-fatal: on a toolchain where SEA works this just prints OK.
console.log('[sidecar] smoke-testing the produced binary…');
const probe = spawnSync(outBinary, [], {
  env: { ...process.env, PORT: '0', OSC_PORT: '0', LEDRUMS_WEB_ROOT: sidecarDir, LEDRUMS_PROJECTS_DIR: sidecarDir },
  timeout: 2500,
  encoding: 'utf8',
});
const probeOut = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
if (/thread-local, larger than 4GB|failed to set up thread local/.test(probeOut)) {
  console.warn(
    '\n[sidecar] WARNING: the SEA binary failed to load with the macOS dyld thread-local error.\n' +
      `          The SEA base was Node ${buildNode === process.execPath ? `v${process.versions.node} (active)` : `pinned v${PINNED_NODE}`}.\n` +
      '          This should not happen with the pinned LTS — try clearing apps/desktop/.node-pin/\n' +
      '          and rebuilding, or set LEDRUMS_SEA_NODE_VERSION to another LTS (even major ≥20).\n',
  );
} else if (probe.error && probe.error.code !== 'ETIMEDOUT') {
  console.warn(`[sidecar] smoke test could not run the binary: ${probe.error.message}`);
} else {
  // ETIMEDOUT means it was still running (booted fine) when we killed it — the success signal.
  console.log('[sidecar] smoke test OK — binary boots.');
}
