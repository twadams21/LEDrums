#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const [, , command, ...args] = process.argv;

if (!command) {
  console.error('usage: node scripts/with-tauri-signing-env.mjs <command> [...args]');
  process.exit(2);
}

const env = { ...process.env };

if (env.LEDRUMS_TAURI_SIGNING_PRIVATE_KEY) {
  env.TAURI_SIGNING_PRIVATE_KEY = env.LEDRUMS_TAURI_SIGNING_PRIVATE_KEY;
}

if (env.LEDRUMS_TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = env.LEDRUMS_TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
}

const child = spawnSync(command, args, {
  env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(child.status ?? 1);
