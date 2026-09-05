// Test the real workspace scanner, including its ability to find an intentionally dead file.
// This deliberately does not auto-delete anything or suppress findings to make the check green.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = `apps/web/src/lib/health-dead-code-probe-${randomUUID()}.ts`;
const path = resolve(root, fixture);
function scan() {
  const result = spawnSync(process.execPath, [
    resolve(root, 'node_modules/knip/bin/knip.js'),
    '--include', 'files,dependencies,unlisted,unresolved,binaries', '--reporter', 'json',
  ], { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.ok(result.status === 0 || result.status === 1, result.stderr || `Knip exit ${result.status}`);
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error(`Knip did not return JSON: ${result.stderr}\n${result.stdout}`); }
  return { status: result.status, report };
}

// Only this UUID-named fixture is removed. Never clean/delete existing project files.
writeFileSync(path, 'export const intentionallyUnreachableHealthProbe = true;\n', { flag: 'wx' });
try {
  const { status, report } = scan();
  assert.equal(status, 1, 'the scanner must fail for a genuinely unreachable source file');
  assert.deepEqual(report.files, [fixture], `unexpected unreachable files: ${JSON.stringify(report.files)}`);
  assert.deepEqual(report.issues, [], `dependency/resolution findings: ${JSON.stringify(report.issues)}`);
  // Exact equality above also protects design-system.ts, shot-seam, desktop shell and @tauri/api.
} finally {
  rmSync(path);
}
const clean = scan();
assert.equal(clean.status, 0, JSON.stringify(clean.report));
assert.deepEqual(clean.report, { files: [], issues: [] });
console.log('Dead-code configuration verified: live workspace entries retained, seeded dead file detected, clean baseline.');
