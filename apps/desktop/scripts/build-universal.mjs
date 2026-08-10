#!/usr/bin/env node
// Build the ONE macOS artifact that serves both architectures, then prove it really is universal.
//
// `tauri build --target universal-apple-darwin` compiles the Rust shell for both darwin targets and
// lipos them. Everything else in the bundle comes from our own packaging scripts, so this wrapper
// sets LEDRUMS_SIDECAR_UNIVERSAL=1 (picked up by build-sidecar.mjs via prepare-bundle.mjs, Tauri's
// beforeBuildCommand) and then runs verify-universal.mjs, which fails the build if ANY Mach-O in
// the produced .app is thin.
//
// Output: src-tauri/target/universal-apple-darwin/release/bundle/macos/{LEDrums.app, *.app.tar.gz[.sig]}
// — one artifact, published under BOTH updater platform keys (see .github/workflows/release-ota.yml).
//
// Usage: pnpm --filter @ledrums/desktop build:universal [-- extra tauri args]
//
// Requires both Rust darwin targets:
//   rustup target add x86_64-apple-darwin aarch64-apple-darwin

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const passthrough = process.argv.slice(2);

function run(cmd, args, extraEnv = {}) {
  console.log(`[universal] $ ${cmd} ${args.join(' ')}`);
  const child = spawnSync(cmd, args, {
    cwd: desktopDir,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}

run('pnpm', ['exec', 'tauri', 'build', '--target', 'universal-apple-darwin', ...passthrough], {
  // prepare-bundle.mjs → build-sidecar.mjs. Tauri also exports TAURI_ENV_TARGET_TRIPLE to the
  // beforeBuildCommand, which build-sidecar.mjs honours too; this makes the intent explicit and
  // independent of that contract.
  LEDRUMS_SIDECAR_UNIVERSAL: '1',
});

run(process.execPath, [join(desktopDir, 'scripts', 'verify-universal.mjs')]);
