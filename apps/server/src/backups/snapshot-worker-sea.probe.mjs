// Isolated P11 packaging evidence. No Tauri, downloads, release, deployed data or output.
// Usage: <pinned Node 22.23.1> snapshot-worker-sea.probe.mjs <empty/absent temp output dir>
// Emits actual main + latency-probe SEAs and the exact pre-change store comparator. Then run
// P11_SEA_BINARY=<dir>/server <pinned node> <vitest> run src/main.integration.test.ts
// and P11_BASELINE_MODULE=<dir>/baseline.cjs <dir>/latency.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const pinned = readFileSync(join(root, 'apps/desktop/.node-version'), 'utf8').trim().replace(/^v/, '');
if (process.version !== `v${pinned}`) throw new Error(`Run with EXACT pinned Node v${pinned}, not ${process.version}`);
const out = process.argv[2];
if (!out || !out.startsWith('/') || existsSync(out)) throw new Error('Supply an ABSOLUTE, NONEXISTENT temporary output directory');
mkdirSync(out, { recursive: true });
const require = createRequire(join(root, 'apps/desktop/package.json'));
const { build } = require('esbuild');
const { inject } = require('postject');
const options = {
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['bufferutil', 'utf-8-validate'], legalComments: 'none',
  banner: { js: "const __ledrumsImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__ledrumsImportMetaUrl' },
};
const old = execFileSync('git', ['show', '0c25083d:apps/server/src/backups/snapshot-store.ts'], { cwd: root, encoding: 'utf8' });
await build({ ...options, stdin: { contents: old, loader: 'ts', resolveDir: here }, outfile: join(out, 'baseline.cjs') });
for (const [name, entry] of [['server', join(root, 'apps/server/src/main.ts')], ['latency', join(here, 'snapshot-worker.probe.ts')]]) {
  const bundle = join(out, `${name}.cjs`), blob = join(out, `${name}.blob`), config = join(out, `${name}.sea.json`), binary = join(out, name);
  await build({ ...options, entryPoints: [entry], outfile: bundle });
  writeFileSync(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
  copyFileSync(process.execPath, binary); chmodSync(binary, 0o755);
  if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', binary]);
  await inject(binary, 'NODE_SEA_BLOB', readFileSync(blob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
  if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', binary]);
  console.log(`${name}: ${binary}`);
}
console.log(`Runtime/generator ${process.version} ${process.arch}; no server has been launched, no controller/output configured.`);
