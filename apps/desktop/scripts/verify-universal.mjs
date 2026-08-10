#!/usr/bin/env node
// Parity guard for the universal macOS bundle: walk a built `.app` and REQUIRE every Mach-O inside
// it to be fat (x86_64 + arm64). Exits non-zero — failing the build — if any is thin.
//
// WHY THIS EXISTS. `tauri build --target universal-apple-darwin` lipos the Rust shell binary, but
// everything else in the bundle is whatever the packaging scripts put there: the Node SEA sidecar
// and cloudflared are fetched/created by our own scripts, and if either stays single-architecture
// the result is a "universal" app that quietly runs its server under Rosetta on Apple Silicon (or
// cannot start it at all). Nothing else catches that — the build is green, the app launches on the
// machine that built it, and the regression only surfaces on the OTHER architecture. So the
// fatness of the bundle is asserted explicitly, on every build.
//
// Usage:
//   node scripts/verify-universal.mjs [path/to/App.app] [--archs x86_64,arm64]
//
// Default target: src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app

import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessArchCoverage, isMachO, parseLipoArchs } from './mach-o.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const DEFAULT_BUNDLE_DIR = join(desktopDir, 'src-tauri', 'target', 'universal-apple-darwin', 'release', 'bundle', 'macos');

const args = process.argv.slice(2);
const archsArg = args.includes('--archs') ? args[args.indexOf('--archs') + 1] : undefined;
const REQUIRED = (archsArg ?? 'x86_64,arm64')
  .split(',')
  .map((a) => a.trim())
  .filter(Boolean);
const pathArg = args.find((a) => !a.startsWith('--') && a !== archsArg);

/** Resolve the `.app` to inspect: an explicit path, else the sole .app in the universal bundle dir. */
function resolveApp() {
  if (pathArg) {
    const p = resolve(pathArg);
    if (!existsSync(p)) throw new Error(`no such path: ${p}`);
    return p;
  }
  if (!existsSync(DEFAULT_BUNDLE_DIR)) {
    throw new Error(
      `no universal bundle at ${DEFAULT_BUNDLE_DIR}. ` +
        `Run \`pnpm --filter @ledrums/desktop build:universal\` first, or pass the .app path.`,
    );
  }
  const apps = readdirSync(DEFAULT_BUNDLE_DIR).filter((f) => f.endsWith('.app'));
  if (apps.length !== 1) {
    throw new Error(`expected exactly one .app in ${DEFAULT_BUNDLE_DIR}, found ${apps.length ? apps.join(', ') : 'none'}`);
  }
  return join(DEFAULT_BUNDLE_DIR, apps[0]);
}

/** First 4 bytes of a file (empty when it is shorter). */
function magicBytes(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4);
    const read = readSync(fd, buf, 0, 4, 0);
    return buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** Every regular file under `dir`, recursively. Symlinks are NOT followed — inside a `.app` they
 *  are framework version aliases pointing at files the walk already visits. */
function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

const app = resolveApp();
console.log(`[universal] checking ${app} for ${REQUIRED.join(' + ')}`);

const entries = [];
const unreadable = [];
for (const file of walkFiles(app)) {
  if (statSync(file).size < 4 || !isMachO(magicBytes(file))) continue;
  const rel = relative(app, file);
  try {
    entries.push({ path: rel, archs: parseLipoArchs(execFileSync('lipo', ['-archs', file], { encoding: 'utf8' })) });
  } catch (e) {
    // Mach-O magic but lipo cannot read it. Fail closed: a binary we cannot verify is not a binary
    // we can claim is universal.
    unreadable.push({ path: rel, reason: e instanceof Error ? e.message.split('\n')[0] : String(e) });
  }
}

const verdict = assessArchCoverage(entries, REQUIRED);
for (const e of entries) {
  console.log(`  ${verdict.thin.some((t) => t.path === e.path) ? '✗' : '✓'} ${e.path}  [${e.archs.join(' ')}]`);
}

if (entries.length === 0) {
  console.error('[universal] FAILED: no Mach-O binaries found — is this really a .app bundle?');
  process.exit(1);
}
if (unreadable.length > 0) {
  console.error(`[universal] FAILED: ${unreadable.length} file(s) look like Mach-O but lipo could not read them:`);
  for (const u of unreadable) console.error(`  - ${u.path}: ${u.reason}`);
  process.exit(1);
}
if (!verdict.ok) {
  console.error(
    `\n[universal] FAILED: ${verdict.thin.length} of ${verdict.checked} Mach-O binaries are not universal.\n` +
      'A bundle with a thin binary inside is a silent single-architecture regression — it works on the\n' +
      'machine that built it and degrades (Rosetta) or breaks on the other one.\n',
  );
  for (const t of verdict.thin) console.error(`  - ${t.path}: has [${t.archs.join(' ')}], missing ${t.missing.join(', ')}`);
  console.error(
    '\nLikely cause: the sidecar or cloudflared was built/fetched single-arch. Rebuild with\n' +
      '  node scripts/build-sidecar.mjs --universal\n' +
      '  node scripts/fetch-cloudflared.mjs --universal\n',
  );
  process.exit(1);
}

console.log(`\n[universal] OK — all ${verdict.checked} Mach-O binaries are universal (${REQUIRED.join(' + ')}).`);
