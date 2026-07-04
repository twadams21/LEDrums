#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const [, , command, ...args] = process.argv;

if (!command) {
  console.error('usage: node scripts/with-tauri-signing-env.mjs <command> [...args]');
  process.exit(2);
}

const env = { ...process.env };

// Prefer the LEDRUMS_-namespaced signing secret; fall back to a bare TAURI_ one. Strip any
// whitespace the secret store may have introduced into the base64 — a single stray space breaks
// the key's base64 decode ("Invalid symbol 32") and fails signing. Stripping is always safe: a
// valid tauri/minisign key is one continuous base64 blob with no meaningful whitespace.
const signingKey = env.LEDRUMS_TAURI_SIGNING_PRIVATE_KEY || env.TAURI_SIGNING_PRIVATE_KEY;
if (signingKey) {
  env.TAURI_SIGNING_PRIVATE_KEY = signingKey.replace(/\s+/g, '');
}

const signingPassword =
  env.LEDRUMS_TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
if (signingPassword !== undefined) {
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = signingPassword;
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
