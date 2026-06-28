#!/usr/bin/env node
/**
 * Publish a whole-bundle OTA release for the LEDrums desktop app (S4 Phase 2).
 *
 * The Tauri v2 updater serves a manifest (`latest.json`) that points at SIGNED bundle artifacts.
 * This script, run AFTER `tauri build`, locates the host platform's updater artifact (+ its `.sig`),
 * uploads both to a PUBLIC Cloudflare R2 bucket, and writes/merges the `latest.json` manifest.
 *
 * Steps:
 *   1. Resolve version (tauri.conf.json `version`, or OTA_VERSION) + the host platform key.
 *   2. Locate the updater artifact (e.g. `*.app.tar.gz`) + signature under
 *      src-tauri/target/release/bundle/.
 *   3. Upload the artifact to r2://<bucket>/<version>/<target>/<file>.
 *   4. Fetch any existing latest.json from the public base, MERGE this platform's entry in (so a
 *      multi-arch release built on several machines accumulates into one manifest), and upload it.
 *
 * Tauri v2 manifest shape:
 *   { version, notes, pub_date, platforms: { "<os>-<arch>": { signature, url } } }
 *   platform key: <os>-<arch>, os ∈ {darwin,linux,windows}, arch ∈ {x86_64,aarch64,i686,armv7}.
 *
 * Run it under Infisical so the signed build's key + the R2 creds are present:
 *   infisical run -- node apps/desktop/scripts/publish-ota.mjs
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   R2 read/write (wrangler reads them automatically)
 *   OTA_PUBLIC_BASE                               the bucket's public base URL, e.g.
 *                                                 https://pub-xxxx.r2.dev  (no trailing /latest.json)
 * Optional env:
 *   OTA_BUCKET   (default "ledrums-ota")          R2 bucket name
 *   OTA_VERSION  (default tauri.conf.json version) override the release version
 *   OTA_TARGET   (default host <os>-<arch>)        override the platform key
 *   OTA_NOTES    (default "")                      release notes string
 *
 * This is TOOLING for the release operator — it performs network side effects and is NOT run in CI
 * or by the build. `tauri build` must already have produced signed updater artifacts (i.e. it was
 * itself run under `infisical run` so TAURI_SIGNING_PRIVATE_KEY[_PASSWORD] were set).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const tauriConfPath = join(desktopDir, 'src-tauri', 'tauri.conf.json');
const bundleDir = join(desktopDir, 'src-tauri', 'target', 'release', 'bundle');

const BUCKET = process.env.OTA_BUCKET || 'ledrums-ota';
const PUBLIC_BASE = process.env.OTA_PUBLIC_BASE?.replace(/\/+$/, '');
const NOTES = process.env.OTA_NOTES || '';

/** Host platform key in Tauri updater form (<os>-<arch>). */
function hostTarget() {
  if (process.env.OTA_TARGET) return process.env.OTA_TARGET;
  const archMap = { x64: 'x86_64', arm64: 'aarch64', ia32: 'i686', arm: 'armv7' };
  const arch = archMap[process.arch] ?? process.arch;
  const osMap = { darwin: 'darwin', win32: 'windows', linux: 'linux' };
  const os = osMap[process.platform] ?? process.platform;
  return `${os}-${arch}`;
}

/**
 * Find the updater artifact + its detached signature for a platform. Tauri emits, per OS:
 *   macOS   bundle/macos/*.app.tar.gz            (+ .sig)
 *   Windows bundle/nsis/*-setup.nsis.zip         (+ .sig)   or bundle/msi/*.msi.zip
 *   Linux   bundle/appimage/*.AppImage.tar.gz    (+ .sig)
 */
function findArtifact(os) {
  const candidates = {
    darwin: [['macos', /\.app\.tar\.gz$/]],
    windows: [
      ['nsis', /-setup\.nsis\.zip$/],
      ['msi', /\.msi\.zip$/],
    ],
    linux: [['appimage', /\.AppImage\.tar\.gz$/]],
  }[os];
  if (!candidates) throw new Error(`unsupported OS for OTA: ${os}`);

  for (const [subdir, pattern] of candidates) {
    const dir = join(bundleDir, subdir);
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((f) => pattern.test(f));
    if (file) {
      const artifactPath = join(dir, file);
      const sigPath = `${artifactPath}.sig`;
      if (!existsSync(sigPath)) {
        throw new Error(
          `found ${file} but no ${file}.sig next to it — was the build signed? ` +
            `Run \`tauri build\` under \`infisical run\` so TAURI_SIGNING_PRIVATE_KEY[_PASSWORD] are set.`,
        );
      }
      return { file, artifactPath, sigPath };
    }
  }
  throw new Error(
    `no updater artifact found under ${bundleDir} for ${os}. ` +
      `Run \`pnpm --filter @ledrums/desktop build\` (with createUpdaterArtifacts) first.`,
  );
}

function r2Put(key, filePath, contentType) {
  const args = [
    '--yes',
    'wrangler@4',
    'r2',
    'object',
    'put',
    `${BUCKET}/${key}`,
    '--file',
    filePath,
    '--content-type',
    contentType,
    '--remote',
  ];
  console.log(`[ota] uploading r2://${BUCKET}/${key}`);
  execFileSync('npx', args, { stdio: 'inherit' });
}

/** Fetch the current manifest so we can merge this platform into it (best-effort). */
async function fetchExistingManifest(version) {
  try {
    const res = await fetch(`${PUBLIC_BASE}/latest.json`, { redirect: 'follow' });
    if (!res.ok) return null;
    const manifest = await res.json();
    // Only merge into a manifest for the SAME version — a new version supersedes old platforms.
    if (manifest?.version === version && manifest?.platforms) return manifest;
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error('error: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set (R2 read/write).');
    process.exit(1);
  }
  if (!PUBLIC_BASE) {
    console.error(
      'error: OTA_PUBLIC_BASE must be set to the bucket public base URL (e.g. https://pub-xxxx.r2.dev). ' +
        'It must match the host in tauri.conf.json plugins.updater.endpoints.',
    );
    process.exit(1);
  }

  const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
  const version = process.env.OTA_VERSION || conf.version;
  if (!version) {
    console.error('error: could not resolve a version (set OTA_VERSION or tauri.conf.json version).');
    process.exit(1);
  }

  const target = hostTarget();
  const os = target.split('-')[0];
  console.log(`[ota] publishing v${version} for ${target}`);

  const { file, artifactPath, sigPath } = findArtifact(os);
  const signature = readFileSync(sigPath, 'utf8').trim();

  // Namespace the object by version + target so multi-arch artifacts (which often share a filename,
  // e.g. LEDrums.app.tar.gz) never overwrite each other.
  const key = `${version}/${target}/${file}`;
  const url = `${PUBLIC_BASE}/${key}`;

  // Upload the artifact FIRST so the manifest never points ahead of an uploaded file.
  const artifactType = file.endsWith('.zip') ? 'application/zip' : 'application/gzip';
  r2Put(key, artifactPath, artifactType);

  // Merge this platform into any existing same-version manifest.
  const existing = await fetchExistingManifest(version);
  const platforms = { ...(existing?.platforms ?? {}) };
  platforms[target] = { signature, url };

  const manifest = {
    version,
    notes: NOTES || existing?.notes || `LEDrums ${version}`,
    pub_date: new Date().toISOString(),
    platforms,
  };

  const work = mkdtempSync(join(tmpdir(), 'ledrums-ota-'));
  const manifestPath = join(work, 'latest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  r2Put('latest.json', manifestPath, 'application/json');

  console.log(
    `\n[ota] published v${version} (${target})\n` +
      `  artifact -> r2://${BUCKET}/${key}\n` +
      `  manifest -> r2://${BUCKET}/latest.json\n` +
      `  platforms now: ${Object.keys(platforms).join(', ')}`,
  );
}

main().catch((err) => {
  console.error(`[ota] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
