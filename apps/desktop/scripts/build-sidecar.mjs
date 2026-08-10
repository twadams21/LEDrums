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
//   node scripts/build-sidecar.mjs [--triple <triple>] [--universal] [--bundle-only]
//
//   --triple       override the auto-detected Rust host triple (for cross-target naming)
//   --universal    macOS: emit ONE fat (x86_64 + arm64) binary — see below
//   --bundle-only  stop after the esbuild bundle (skip SEA) — useful when Node SEA tooling
//                  is unavailable; the orchestrator can finish packaging from the .cjs.
//
// Producing a binary for ANOTHER target triple requires building ON that platform (Node SEA
// copies the *host* node executable; it is not a cross-compiler). Run this script on each
// target OS/arch, or in that platform's CI, passing --triple if auto-detection is wrong.
//
// UNIVERSAL macOS (`--universal`, or LEDRUMS_SIDECAR_UNIVERSAL=1, or a `universal-apple-darwin`
// triple). The "not a cross-compiler" caveat above is about EXECUTING node, and the SEA steps do
// not need to execute the foreign-arch node: the SEA blob is arch-independent (this script sets
// `useSnapshot: false` and `useCodeCache: false` — the two options that would bake a host-specific
// V8 artifact into it — so the blob is just the JS payload plus SEA metadata), and postject injects
// it by editing the Mach-O structurally. So we generate the blob ONCE with the runnable host Node,
// download the pinned LTS for BOTH darwin arches, inject the same blob into each, and
// `lipo -create` the pair into one fat binary.
//
// That fat binary is written under THREE names, because a universal Tauri build asks for all
// three: `tauri-build`'s build script runs once per cargo target and resolves `externalBin`
// against the PER-ARCH triples (`…-x86_64-apple-darwin`, `…-aarch64-apple-darwin`), while the
// bundler resolves it against the BUILD target (`…-universal-apple-darwin`). A missing name fails
// the build; a thin binary under any of them would be a silent single-arch regression — which is
// what `verify-universal.mjs` exists to catch.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import dgram from 'node:dgram';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
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

const UNIVERSAL_TRIPLE = 'universal-apple-darwin';
/** Fat-binary mode. `TAURI_ENV_TARGET_TRIPLE` is set by Tauri for beforeBuildCommand, so a
 *  `tauri build --target universal-apple-darwin` reaches us even without the explicit flag. */
const universal =
  args.includes('--universal') ||
  process.env.LEDRUMS_SIDECAR_UNIVERSAL === '1' ||
  tripleArg === UNIVERSAL_TRIPLE ||
  process.env.TAURI_ENV_TARGET_TRIPLE === UNIVERSAL_TRIPLE;

if (universal && process.platform !== 'darwin') {
  throw new Error(`--universal is macOS-only (lipo); this host is ${process.platform}.`);
}

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

const triple = universal ? UNIVERSAL_TRIPLE : hostTriple();
const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const outBinary = join(binariesDir, `ledrums-server-${triple}${exeSuffix}`);
/** Extra names the SAME fat binary is copied to (see the universal note in the header). */
const aliasBinaries = universal
  ? ['x86_64-apple-darwin', 'aarch64-apple-darwin'].map((t) => join(binariesDir, `ledrums-server-${t}`))
  : [];

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
 * Download + checksum-verify + cache the pinned Node build for one platform/arch, returning the
 * path to its `node` executable. Throws on any failure — callers decide whether a fallback is
 * acceptable (it is for the host arch, it is NOT for a foreign arch: there is no substitute, and
 * silently skipping it would produce a thin binary).
 *
 * @param {'darwin'|'linux'|'win'} platform
 * @param {'x64'|'arm64'} arch
 */
async function fetchPinnedNode(platform, arch) {
  const isWin = platform === 'win';
  const name = `node-v${PINNED_NODE}-${platform}-${arch}`;
  const ext = isWin ? 'zip' : 'tar.gz';
  const cacheRoot = join(desktopDir, '.node-pin');
  const nodeBin = isWin ? join(cacheRoot, name, 'node.exe') : join(cacheRoot, name, 'bin', 'node');

  if (existsSync(nodeBin)) {
    console.log(`[sidecar] using cached pinned Node v${PINNED_NODE} (${platform}-${arch})`);
    return nodeBin;
  }

  mkdirSync(cacheRoot, { recursive: true });
  const base = `https://nodejs.org/dist/v${PINNED_NODE}`;
  console.log(`[sidecar] fetching pinned LTS v${PINNED_NODE} (${name}.${ext}) as a postject-safe SEA base…`);
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
}

/** The pinned-Node coordinates for THIS host (also the only Node we can actually execute). */
const hostNodePlatform = process.platform === 'win32' ? 'win' : process.platform; // darwin | linux | win
const hostNodeArch = { x64: 'x64', arm64: 'arm64' }[process.arch] ?? process.arch;

/**
 * Resolve a Node executable to use as the SEA base for the HOST. Uses the active Node when it is
 * already on the pinned line; otherwise downloads the pinned LTS. Falls back to the active Node
 * only when it is an even-major LTS and the download is unavailable (offline CI); refuses to
 * produce a known-broken binary on a Current line.
 */
async function resolveBuildNode() {
  const wantMajor = PINNED_NODE.split('.')[0];
  const curMajor = process.versions.node.split('.')[0];
  if (curMajor === wantMajor) return process.execPath; // already on the pinned line

  try {
    console.log(`[sidecar] active Node is v${process.versions.node}; using the pinned LTS instead.`);
    return await fetchPinnedNode(hostNodePlatform, hostNodeArch);
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

// The blob generator must be a node we can EXECUTE, so it is always the host's.
const buildNode = await resolveBuildNode();
const seaBaseLabel = buildNode === process.execPath ? `v${process.versions.node} (active)` : `pinned v${PINNED_NODE}`;

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

const isMac = process.platform === 'darwin';
const { inject } = await import('postject');
const blob = readFileSync(blobFile);

/**
 * Turn one Node executable into the SEA at `dest`: copy, strip its signature (postject mutates the
 * Mach-O, which invalidates it), inject the blob. Signing is deliberately NOT done here — a
 * universal build signs once at the end, after lipo, and `codesign` signs every slice of a fat
 * binary in one pass.
 */
async function makeSea(nodeExe, dest) {
  rmSync(dest, { force: true });
  copyFileSync(nodeExe, dest);
  chmodSync(dest, 0o755);
  if (isMac) {
    try {
      execFileSync('codesign', ['--remove-signature', dest], { stdio: 'inherit' });
    } catch {
      console.warn('[sidecar] codesign --remove-signature failed (continuing)');
    }
  }
  console.log(`[sidecar] injecting SEA blob with postject → ${dest}`);
  await inject(dest, 'NODE_SEA_BLOB', blob, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    machoSegmentName: isMac ? 'NODE_SEA' : undefined,
  });
  chmodSync(dest, 0o755);
}

if (universal) {
  // One SEA per darwin arch, then lipo them into a single fat binary. The FOREIGN arch has no
  // fallback: if its pinned Node cannot be fetched we must fail, never quietly ship a thin binary.
  const slices = [];
  for (const arch of ['x64', 'arm64']) {
    const isHost = arch === hostNodeArch;
    const nodeExe =
      isHost && buildNode === process.execPath && process.versions.node === PINNED_NODE
        ? process.execPath
        : await fetchPinnedNode('darwin', arch).catch((e) => {
            throw new Error(
              `universal build needs the pinned Node v${PINNED_NODE} for darwin-${arch} and it could not ` +
                `be fetched (${e.message}). Refusing to emit a single-architecture sidecar. ` +
                `Fix connectivity, or pre-populate apps/desktop/.node-pin/.`,
            );
          });
    const slice = join(sidecarDir, `ledrums-server.${arch}`);
    await makeSea(nodeExe, slice);
    slices.push(slice);
  }
  rmSync(outBinary, { force: true });
  execFileSync('lipo', ['-create', '-output', outBinary, ...slices], { stdio: 'inherit' });
  for (const slice of slices) rmSync(slice, { force: true });
} else {
  await makeSea(buildNode, outBinary);
}

if (isMac) {
  try {
    execFileSync('codesign', ['--sign', '-', outBinary], { stdio: 'inherit' });
  } catch {
    console.warn('[sidecar] codesign --sign - failed (binary may need manual ad-hoc signing)');
  }
}

chmodSync(outBinary, 0o755);

if (universal) {
  // Fail here rather than at bundle time: a thin "universal" sidecar is the exact silent
  // regression this slice exists to prevent.
  const archs = execFileSync('lipo', ['-archs', outBinary], { encoding: 'utf8' }).trim().split(/\s+/);
  for (const want of ['x86_64', 'arm64']) {
    if (!archs.includes(want)) {
      throw new Error(`universal sidecar is missing the ${want} slice (lipo -archs → "${archs.join(' ')}")`);
    }
  }
  console.log(`[sidecar] universal sidecar verified: ${archs.join(' + ')}`);
  for (const alias of aliasBinaries) {
    rmSync(alias, { force: true });
    copyFileSync(outBinary, alias);
    chmodSync(alias, 0o755);
    console.log(`[sidecar] also emitted → ${alias}`);
  }
}

console.log(`[sidecar] done → ${outBinary}`);

// --- 3. smoke test (gates the build) ---------------------------------------
//
// Boot the produced binary and REQUIRE it to reach the server's `listening on` banner. This
// proves the SEA actually loads + the server starts — catching the macOS dyld TLV failure
// ("unsupported thread-local, larger than 4GB") AND any other early crash. The build FAILS
// (exit 1) on early exit, the dyld error, a spawn error, or a timeout with no banner, so a
// broken binary can never be shipped silently.
//
// For a universal binary this exercises the HOST slice only — macOS runs the matching arch and
// there is no way to execute the other one here. The foreign slice's proof is structural (the
// `lipo -archs` assertion above and verify-universal.mjs) plus a run on that architecture in CI.
//
// The server reads `Number(env) || default`, so PORT=0 would fall back to the real default port;
// we therefore bind real free TCP/UDP ports for the probe and pass those, avoiding collisions
// with anything already running (e.g. a dev server on 4321) and with the OSC default.

/** Reserve a free TCP port (closed again before returning, so the probe can bind it). */
function freeTcpPort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

/** Reserve a free UDP port (for OSC), closed again before returning. */
function freeUdpPort() {
  return new Promise((res, rej) => {
    const sock = dgram.createSocket('udp4');
    sock.on('error', rej);
    sock.bind(0, '127.0.0.1', () => {
      const { port } = sock.address();
      sock.close(() => res(port));
    });
  });
}

const BANNER = /LEDrums server listening on/;
const DYLD_TLV = /thread-local, larger than 4GB|failed to set up thread local/;

console.log('[sidecar] smoke-testing the produced binary (must reach the listening banner)…');
const probePort = await freeTcpPort();
const probeOscPort = await freeUdpPort();
const verdict = await new Promise((resolveVerdict) => {
  const child = spawn(outBinary, [], {
    env: {
      ...process.env,
      PORT: String(probePort),
      OSC_PORT: String(probeOscPort),
      LEDRUMS_WEB_ROOT: sidecarDir,
      LEDRUMS_PROJECTS_DIR: sidecarDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let settled = false;
  const finish = (ok, reason) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
    resolveVerdict({ ok, reason, out });
  };
  const timer = setTimeout(() => finish(false, 'timed out before the listening banner'), 10_000);
  const onData = (chunk) => {
    out += chunk.toString();
    if (DYLD_TLV.test(out)) finish(false, 'macOS dyld thread-local error (SEA failed to load)');
    else if (BANNER.test(out)) finish(true);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => finish(false, `could not spawn the binary: ${e.message}`));
  child.on('exit', (code, signal) => {
    if (!BANNER.test(out)) finish(false, `exited early (code ${code}, signal ${signal}) before the listening banner`);
  });
});

if (!verdict.ok) {
  console.error(
    `\n[sidecar] SMOKE TEST FAILED: ${verdict.reason}.\n` +
      `          SEA base Node: ${seaBaseLabel}. Captured output:\n` +
      verdict.out.split('\n').map((l) => `          | ${l}`).join('\n') +
      '\n',
  );
  if (DYLD_TLV.test(verdict.out)) {
    console.error(
      '[sidecar] The dyld thread-local error should not happen with the pinned LTS — clear\n' +
        '          apps/desktop/.node-pin/ and rebuild, or set LEDRUMS_SEA_NODE_VERSION to an LTS.\n',
    );
  }
  process.exit(1);
}
console.log('[sidecar] smoke test OK — server reached the listening banner.');
