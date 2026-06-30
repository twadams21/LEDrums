#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const repoRoot = resolve(desktopDir, '..', '..');

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

function bumpPatch(version) {
  const parts = version.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`expected semver patch version like 0.1.0, got ${version}`);
  }
  parts[2] = String(Number(parts[2]) + 1);
  return parts.join('.');
}

function updateJsonVersion(file, next) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const prev = json.version;
  json.version = next;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  return prev;
}

function updateCargoVersion(file, next) {
  const text = readFileSync(file, 'utf8');
  const prev = text.match(/^version = "([^"]+)"/m)?.[1];
  if (!prev) throw new Error(`could not find package version in ${file}`);
  writeFileSync(file, text.replace(/^version = "[^"]+"/m, `version = "${next}"`));
  return prev;
}

function bump() {
  const tauriConf = join(desktopDir, 'src-tauri', 'tauri.conf.json');
  const current = JSON.parse(readFileSync(tauriConf, 'utf8')).version;
  const next = bumpPatch(current);

  updateJsonVersion(tauriConf, next);
  updateJsonVersion(join(desktopDir, 'package.json'), next);
  updateCargoVersion(join(desktopDir, 'src-tauri', 'Cargo.toml'), next);

  console.log(`[ota] bumped desktop version ${current} -> ${next}`);
  console.log('[ota] run pnpm tauri:build, then pnpm ota');
}

function publish() {
  loadEnvLocal();
  const base = process.env.OTA_PUBLIC_BASE || process.env.BASE;
  if (!base) {
    console.error('error: set BASE or OTA_PUBLIC_BASE in .env.local');
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

const command = process.argv[2] ?? 'publish';

try {
  if (command === 'bump') bump();
  else if (command === 'publish') publish();
  else {
    console.error('usage: pnpm ota [bump]');
    process.exit(2);
  }
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
