import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertSeaBuildEnvironment, matchesNodeCacheReceipt, PINNED_NODE_VERSION, resolveSeaNode } from './sea-node.mjs';

const exact = PINNED_NODE_VERSION;
const [major, minor, patch] = exact.split('.').map(Number);
const otherPatch = `${major}.${minor}.${patch + 1}`;
const local = { ci: false, override: '' };
const noFetch = () => { throw new Error('must not fetch'); };
const options = { ...local, version: exact, execPath: '/active/node', fetchNode: noFetch, readVersion: () => exact };

test('one exact file pin, not a range or an environment version source', () => {
  assert.match(exact, /^\d+\.\d+\.\d+$/);
  assert.equal(exact, readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim());
  assert.throws(() => assertSeaBuildEnvironment({ ...local, override: otherPatch }), /cannot override/);
  assert.doesNotThrow(() => assertSeaBuildEnvironment({ ...local, override: `v${exact}` }));
});

test('strict builds cannot reuse an unverified old sidecar; local host iteration still can', () => {
  for (const mode of [{ universal: true }, { ci: true }]) {
    assert.throws(() => assertSeaBuildEnvironment({ ...local, ...mode, version: exact, skipSidecar: true }), /PREPARE_SKIP_SIDECAR is local host-only/);
  }
  assert.doesNotThrow(() => assertSeaBuildEnvironment({ ...local, skipSidecar: true }));
});

test('universal and CI reject same-major patch/minor and major mismatches before downloads', async () => {
  for (const mode of [{ universal: true }, { ci: true }]) {
    for (const version of [otherPatch, `${major}.${minor + 1}.0`, '25.8.2']) {
      await assert.rejects(resolveSeaNode({ ...options, ...mode, version }), /SEA Node version mismatch.*active/);
    }
  }
});

test('exact pinned active executable is both generator and runtime in strict modes', async () => {
  for (const mode of [{ universal: true }, { ci: true }, {}]) {
    const result = await resolveSeaNode({ ...options, ...mode });
    assert.deepEqual(result, { path: '/active/node', version: exact, source: 'active' });
  }
});

test('host-only local same-major mismatch fetches the exact pin rather than using the active line', async () => {
  let fetched = 0;
  const result = await resolveSeaNode({
    ...options,
    version: otherPatch,
    fetchNode: async () => { fetched++; return '/pinned/node'; },
    readVersion: (path) => { assert.equal(path, '/pinned/node'); return exact; },
  });
  assert.equal(fetched, 1);
  assert.deepEqual(result, { path: '/pinned/node', version: exact, source: 'pinned' });
});

test('local Current Node can still build using a downloaded pinned host runtime', async () => {
  const result = await resolveSeaNode({ ...options, version: '25.8.2', fetchNode: async () => '/pinned/node' });
  assert.equal(result.path, '/pinned/node');
  assert.equal(result.version, exact);
});

test('offline local even-major fallback is explicit and uses the active executable for both roles', async () => {
  for (const version of [otherPatch, '20.19.0', '24.1.0']) {
    const warnings = [];
    const result = await resolveSeaNode({
      ...options, version,
      fetchNode: async () => { throw new Error('offline'); },
      readVersion: () => version,
      warn: (message) => warnings.push(message),
    });
    assert.deepEqual(result, { path: '/active/node', version, source: 'local-fallback' });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /NON-REPRODUCIBLE local host-only fallback/);
    assert.match(warnings[0], /Both SEA generator and runtime/);
  }
});

test('offline local unsupported/Current versions refuse instead of producing a broken SEA', async () => {
  for (const version of ['18.20.0', '21.7.0', '25.8.2']) {
    await assert.rejects(resolveSeaNode({ ...options, version, fetchNode: async () => { throw new Error('offline'); } }), /not an even-major LTS fallback/);
  }
});

test('wrong downloaded/cached executable fails exact version probe and cannot trigger fallback', async () => {
  await assert.rejects(resolveSeaNode({
    ...options, version: otherPatch,
    fetchNode: async () => '/wrong-cache/node',
    readVersion: () => otherPatch,
    warn: () => assert.fail('must not fall back from a wrong fetched version'),
  }), /SEA Node version mismatch.*reports/);
});

test('foreign cache requires a matching version/platform/arch receipt and unchanged executable bytes', () => {
  const name = `node-v${exact}-darwin-arm64`;
  const bytes = Buffer.from('verified official executable fixture');
  const receipt = { name, sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.equal(matchesNodeCacheReceipt(name, bytes, receipt), true);
  for (const other of [undefined, null, {}, { ...receipt, name: `node-v${otherPatch}-darwin-arm64` }, { ...receipt, name: `node-v${exact}-darwin-x64` }]) {
    assert.equal(matchesNodeCacheReceipt(name, bytes, other), false);
  }
  assert.equal(matchesNodeCacheReceipt(name, Buffer.from('replaced executable'), receipt), false);
});

test('actual executable probe catches a mislabeled active runtime', async () => {
  await assert.rejects(resolveSeaNode({ ...options, readVersion: () => otherPatch }), /SEA Node version mismatch.*reports/);
});

test('real executable --version probe validates the runtime rather than trusting a path label', async () => {
  const result = await resolveSeaNode({
    ...local,
    version: process.versions.node,
    fetchNode: async () => process.execPath,
  }).catch((error) => {
    // The running test Node may not be the pin: returning it as a "download" must be rejected.
    assert.notEqual(process.versions.node, exact);
    assert.match(error.message, /SEA Node version mismatch.*reports/);
    return null;
  });
  if (process.versions.node === exact) assert.equal(result.path, process.execPath);
});

test('mismatch smoke: actual sidecar CLI refuses universal/CI before esbuild, downloads or artifact directories', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'SEA mismatch smoke '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const desktop = join(root, 'apps', 'desktop');
  const scripts = join(desktop, 'scripts');
  mkdirSync(scripts, { recursive: true });
  for (const name of ['build-sidecar.mjs', 'build-universal.mjs', 'prepare-bundle.mjs', 'shell-tokens.mjs', 'sea-node.mjs']) {
    copyFileSync(new URL(name, import.meta.url), join(scripts, name));
  }
  // Always a real mismatch, even when the test runner itself is the pinned Node in CI.
  writeFileSync(join(desktop, '.node-version'), process.versions.node === exact ? otherPatch : exact);
  const cases = [
    ['build-sidecar.mjs', ['--universal'], '', ''],
    ['build-sidecar.mjs', [], 'true', ''],
    ['build-sidecar.mjs', ['--universal', '--bundle-only'], '', ''],
    ['build-universal.mjs', [], '', ''],
    ['prepare-bundle.mjs', [], 'true', ''],
    ['prepare-bundle.mjs', [], '', 'universal-apple-darwin'],
  ];
  for (const [script, args, ci, triple] of cases) {
    const result = spawnSync(process.execPath, [join(scripts, script), ...args], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, CI: ci, GITHUB_ACTIONS: '', LEDRUMS_SEA_NODE_VERSION: '', LEDRUMS_SIDECAR_UNIVERSAL: '', TAURI_ENV_TARGET_TRIPLE: triple, PREPARE_SKIP_SIDECAR: '' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SEA Node version mismatch/);
    assert.doesNotMatch(result.stdout, /bundling|fetching|generating|\[prepare\]|\[universal\]/);
    assert.equal(existsSync(join(desktop, 'sidecar')), false);
    assert.equal(existsSync(join(desktop, 'src-tauri', 'binaries')), false);
    assert.equal(existsSync(join(desktop, '.node-pin')), false);
  }
});

test('release setup and desktop CI read the same pin; universal injection retains portability and alias checks', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/release-ota.yml', import.meta.url), 'utf8');
  assert.equal((workflow.match(/node-version-file: apps\/desktop\/\.node-version/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /node-version:/);
  const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8').split('\n  desktop:')[1];
  assert.match(ci, /node-version-file: apps\/desktop\/\.node-version/);
  assert.doesNotMatch(ci, /node-version:/);
  const script = readFileSync(new URL('build-sidecar.mjs', import.meta.url), 'utf8');
  assert.match(script, /PINNED_NODE_VERSION as PINNED_NODE/);
  assert.doesNotMatch(script, /22\.\d+\.\d+|wantMajor|curMajor/);
  assert.ok(script.indexOf('assertSeaBuildEnvironment({ universal })') < script.indexOf('mkdirSync(sidecarDir'));
  assert.match(script, /arch === hostNodeArch \? buildNode : await fetchPinnedNode\('darwin', arch\)/);
  assert.match(script, /execFileSync\(buildNode, \['--experimental-sea-config'/);
  assert.match(script, /await makeSea\(buildNode, outBinary\)/);
  assert.match(script, /useSnapshot: false, useCodeCache: false/);
  assert.match(script, /\['x86_64-apple-darwin', 'aarch64-apple-darwin'\]/);
  assert.match(script, /execFileSync\('lipo', \['-archs', outBinary\]/);
  assert.match(script, /matchesNodeCacheReceipt\(name, readFileSync\(nodeBin\), receipt\)/);
});
