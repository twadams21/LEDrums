#!/usr/bin/env node
/**
 * LEDrums OTA release driver.
 *
 * One command, changes → deployed:
 *
 *   infisical run --env=prod -- pnpm ota bump [--major|--minor|--patch]
 *
 * `bump` runs the WHOLE pipeline: bump the version → build a signed desktop bundle → publish the
 * updater artifact + manifest to R2. `--patch` is the default; `--minor` / `--major` bump those
 * fields (resetting the lower ones). It must run under `infisical run --env=prod` so the signing
 * key (LEDRUMS_TAURI_SIGNING_PRIVATE_KEY) and R2 creds are present.
 *
 * Sub-commands:
 *   bump [--level] [--dry-run]  full pipeline (bump + build + sign + publish)  ← everyday release
 *                               --dry-run prints the plan without changing/building/publishing
 *   version                     print the current version (read-only)
 *   publish                     publish an already-built signed bundle (e.g. another platform's arch)
 *
 * The build signs the updater artifact inline (via with-tauri-signing-env.mjs, which prefers the
 * LEDRUMS_-namespaced key and strips any whitespace the secret store introduced). publish-ota.mjs
 * then verifies the signature was made with the key baked into the app before uploading — so a
 * wrong/rotated signing key aborts the release instead of shipping an unverifiable update.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const repoRoot = resolve(desktopDir, '..', '..');
const tauriConf = join(desktopDir, 'src-tauri', 'tauri.conf.json');
const versionFiles = [
  join(repoRoot, 'package.json'),
  join(repoRoot, 'apps', 'web', 'package.json'),
  join(desktopDir, 'package.json'),
  join(desktopDir, 'src-tauri', 'tauri.conf.json'),
  join(desktopDir, 'src-tauri', 'Cargo.toml'),
  join(desktopDir, 'src-tauri', 'Cargo.lock'),
];

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

/** Which semver field to bump, from `--major|--minor|--patch` (or bare `major|minor|patch`). */
function parseLevel(args) {
  const levels = ['major', 'minor', 'patch'];
  const found = args.map((a) => a.replace(/^--/, '')).filter((a) => levels.includes(a));
  if (found.length > 1) throw new Error(`pick one of --major/--minor/--patch, got: ${found.join(', ')}`);
  return found[0] ?? 'patch';
}

function bumpVersion(version, level) {
  const parts = version.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`expected semver version like 0.1.0, got ${version}`);
  }
  let [major, minor, patch] = parts.map(Number);
  if (level === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (level === 'minor') [major, minor, patch] = [major, minor + 1, 0];
  else [major, minor, patch] = [major, minor, patch + 1];
  return `${major}.${minor}.${patch}`;
}

function updateJsonVersion(file, next) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = next;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function updateCargoVersion(file, next) {
  const text = readFileSync(file, 'utf8');
  if (!/^version = "[^"]+"/m.test(text)) throw new Error(`could not find package version in ${file}`);
  writeFileSync(file, text.replace(/^version = "[^"]+"/m, `version = "${next}"`));
}

function updateCargoLockPackageVersion(file, packageName, next) {
  const text = readFileSync(file, 'utf8');
  const block = new RegExp(`(\\[\\[package\\]\\]\\nname = "${packageName}"\\nversion = ")[^"]+(")`);
  if (!block.test(text)) throw new Error(`could not find ${packageName} package version in ${file}`);
  writeFileSync(file, text.replace(block, `$1${next}$2`));
}

function relativePath(file) {
  return file.startsWith(`${repoRoot}/`) ? file.slice(repoRoot.length + 1) : file;
}

function runGit(args, errorMessage) {
  const child = spawnSync('git', args, { cwd: repoRoot, stdio: 'inherit' });
  if (child.status !== 0) {
    throw new Error(`${errorMessage} (git ${args.join(' ')})`);
  }
}

function ensureCleanWorkingTree() {
  const child = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  if (child.status !== 0) {
    throw new Error('could not inspect git working tree before OTA bump');
  }
  if (child.stdout.trim()) {
    throw new Error('cannot run OTA bump with a dirty working tree; commit, stash, or discard local changes first');
  }
}

function commitVersionBump(current, next) {
  const paths = versionFiles.map(relativePath);
  runGit(['add', ...paths], 'could not stage OTA version files');
  runGit(['commit', '-m', `version bump: v${current} -> v${next}`], 'could not commit OTA version bump');
}

/** Bump the app version across web + desktop metadata. tauri.conf.json remains OTA source of truth. */
function bumpFiles(level) {
  const current = JSON.parse(readFileSync(tauriConf, 'utf8')).version;
  const next = bumpVersion(current, level);
  updateJsonVersion(tauriConf, next);
  updateJsonVersion(join(repoRoot, 'package.json'), next);
  updateJsonVersion(join(repoRoot, 'apps', 'web', 'package.json'), next);
  updateJsonVersion(join(desktopDir, 'package.json'), next);
  updateCargoVersion(join(desktopDir, 'src-tauri', 'Cargo.toml'), next);
  updateCargoLockPackageVersion(join(desktopDir, 'src-tauri', 'Cargo.lock'), 'ledrums-desktop', next);
  console.log(`[ota] bumped app version ${current} -> ${next} (${level})`);
  return next;
}

/** Build a signed desktop bundle. Signing env is set up by with-tauri-signing-env.mjs. */
function build() {
  console.log('[ota] building signed desktop bundle (tauri build)…');
  const child = spawnSync(
    process.execPath,
    [join(desktopDir, 'scripts', 'with-tauri-signing-env.mjs'), 'pnpm', '--filter', '@ledrums/desktop', 'build'],
    { cwd: repoRoot, env: process.env, stdio: 'inherit' },
  );
  if (child.status !== 0) {
    console.error('[ota] build failed — aborting release (version files are already bumped).');
    process.exit(child.status ?? 1);
  }
}

/** Publish the freshly-built signed artifact + manifest. publish-ota.mjs verifies the signature
 *  key id against the app's baked-in updater pubkey before uploading anything. */
function publish() {
  loadEnvLocal();
  const base = process.env.OTA_PUBLIC_BASE || process.env.BASE;
  if (!base) {
    console.error('error: set BASE or OTA_PUBLIC_BASE in .env.local (the R2 public base URL)');
    process.exit(1);
  }
  const env = { ...process.env, OTA_PUBLIC_BASE: base };
  const child = spawnSync(process.execPath, [join(desktopDir, 'scripts', 'publish-ota.mjs')], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  process.exit(child.status ?? 1);
}

/** The current desktop version (tauri.conf.json is the source of truth). */
function currentVersion() {
  return JSON.parse(readFileSync(tauriConf, 'utf8')).version;
}

/** True if any `--dry-run` / `--dryrun` flag is present. */
function hasDryRun(args) {
  return args.some((a) => a === '--dry-run' || a === '--dryrun');
}

/** The everyday release: bump → build (sign) → publish. `--dry-run` prints the plan and exits
 *  without changing, building, or publishing anything. */
function release(level, dryRun) {
  const current = currentVersion();
  const next = bumpVersion(current, level);
  if (dryRun) {
    console.log(`[ota] DRY RUN — would release ${current} -> ${next} (${level}):`);
    console.log('  1. require a clean git working tree');
    console.log('  2. bump app versions in root package.json, apps/web/package.json, desktop package.json, tauri.conf.json, Cargo.toml, Cargo.lock');
    console.log(`  3. commit: version bump: v${current} -> v${next}`);
    console.log('  4. build a signed desktop bundle (tauri build)');
    console.log("  5. verify the signature key matches the app's updater pubkey");
    console.log('  6. publish the artifact + manifest to R2');
    console.log('[ota] dry run — nothing was changed, built, or published.');
    return;
  }
  ensureCleanWorkingTree();
  bumpFiles(level);
  commitVersionBump(current, next);
  build();
  publish(); // exits with publish-ota's status
}

const [, , command = 'bump', ...rest] = process.argv;

try {
  if (command === 'bump') release(parseLevel(rest), hasDryRun(rest));
  else if (command === 'version') console.log(currentVersion());
  else if (command === 'publish') publish();
  else {
    console.error('usage: pnpm ota <bump|version|publish> [--major|--minor|--patch] [--dry-run]');
    console.error('  bump      bump + build + sign + publish  (run under `infisical run --env=prod`)');
    console.error('  bump --dry-run   print the release plan without changing anything');
    console.error('  version   print the current version');
    console.error('  publish   publish an already-built signed bundle');
    process.exit(2);
  }
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
