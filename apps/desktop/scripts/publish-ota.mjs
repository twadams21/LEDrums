#!/usr/bin/env node
/**
 * Publish a whole-bundle OTA release for the LEDrums desktop app (S4 Phase 2).
 *
 * The Tauri v2 updater serves a manifest (`latest.json`) that points at SIGNED bundle artifacts.
 * This script, run AFTER `tauri build`, locates the host platform's updater artifact (+ its `.sig`),
 * uploads both to a PUBLIC Cloudflare R2 bucket, and writes/merges the `latest.json` manifest.
 *
 * Steps:
 *   1. Resolve the version from tauri.conf.json `version` (the SOURCE OF TRUTH — it is baked into the
 *      built app). OTA_VERSION, if set, only ASSERTS that expected version; a mismatch is a hard
 *      error (unless OTA_ALLOW_VERSION_MISMATCH=1) so the manifest can never drift from the artifact.
 *   2. Locate the updater artifact (e.g. `*.app.tar.gz`) + signature under
 *      src-tauri/target/release/bundle/.
 *   3. Upload the artifact to r2://<bucket>/<version>/<target>/<file>.
 *   3b. Archive the web build's hidden sourcemaps to r2://<bucket>/<version>/sourcemaps/ (#122) so a
 *      minified stack trace from any released build stays symbolicatable.
 *   4. Fetch any existing latest.json from the public base, MERGE this platform's entry in (so a
 *      multi-arch release built on several machines accumulates into one manifest), and upload it.
 *
 * !! SERIAL PUBLISHING ONLY !! latest.json is read-modify-write (fetch → merge one platform → upload).
 * Two `publish-ota.mjs` runs in flight at once can read the same manifest and clobber each other's
 * platform entry. Publish each platform's build ONE AT A TIME — never concurrently.
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
 *   OTA_VERSION  (default unset)                  assert the expected version; must equal the
 *                                                 tauri.conf.json version or publishing aborts
 *   OTA_ALLOW_VERSION_MISMATCH (default unset)    set to "1" to publish despite an OTA_VERSION
 *                                                 mismatch (emergency override; warns loudly)
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
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const tauriConfPath = join(desktopDir, 'src-tauri', 'tauri.conf.json');
const bundleDir = join(desktopDir, 'src-tauri', 'target', 'release', 'bundle');
/** The web build output (hidden `.js.map` sourcemaps land here — see apps/web/vite.config.ts). */
const webDistDir = resolve(desktopDir, '..', 'web', 'dist');

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

/** The 8-byte key id (hex) of a base64-encoded minisign public-key or signature file. Both files
 *  are `untrusted comment:` line + a base64 payload of `alg[2] + keyId[8] + …`. */
function minisignKeyId(base64File) {
  const text = Buffer.from(base64File, 'base64').toString('utf8');
  const payloadLine = text
    .split(/\r?\n/)
    .find((l) => l && !l.startsWith('untrusted comment') && !l.startsWith('trusted comment'));
  if (!payloadLine) throw new Error('malformed minisign file: no base64 payload line');
  return Buffer.from(payloadLine, 'base64').subarray(2, 10).toString('hex');
}

/** Abort unless the signature was made with the key whose PUBLIC half is baked into the app
 *  (tauri.conf.json plugins.updater.pubkey). A mismatch means every client rejects the update, so
 *  we must fail BEFORE uploading rather than ship an unverifiable release — the guard that catches a
 *  wrong or rotated signing key (e.g. a build signed under the wrong Infisical environment). */
function assertSignatureMatchesUpdaterKey(conf, signatureB64) {
  const pubkey = conf?.plugins?.updater?.pubkey;
  if (!pubkey) return; // no updater configured — nothing to verify
  const pubId = minisignKeyId(pubkey);
  const sigId = minisignKeyId(signatureB64);
  if (pubId !== sigId) {
    throw new Error(
      `signature key id ${sigId} does not match the app's updater pubkey ${pubId}. The signing key ` +
        `differs from the one baked into the app, so every client would REJECT this update. Aborting ` +
        'before upload — check the build ran with the right signing key (e.g. `infisical run --env=prod`).',
    );
  }
  console.log(`[ota] signature key id ${sigId} matches the app updater pubkey ✓`);
}

/** Recursively collect `.map` files under `dir` (with their dist-relative paths). */
function collectSourcemaps(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourcemaps(p, base));
    else if (entry.name.endsWith('.map')) out.push({ path: p, rel: relative(base, p).split(sep).join('/') });
  }
  return out;
}

/**
 * Archive the web build's hidden sourcemaps to R2 keyed by version (#122), so a minified stack trace
 * from ANY released build stays symbolicatable forever. Platform-independent (the JS bundle is the
 * same across arches), so re-running per platform just idempotently re-uploads the same keys. Absent
 * maps (e.g. a build with sourcemaps disabled) is a loud skip, never a silent one.
 */
function uploadSourcemaps(version) {
  const maps = collectSourcemaps(webDistDir);
  if (maps.length === 0) {
    console.warn(
      `[ota] WARNING: no .js.map files under ${webDistDir} — sourcemaps NOT archived for v${version}. ` +
        'A build with no archived map is un-symbolicatable forever. Is build.sourcemap enabled in vite.config.ts?',
    );
    return;
  }
  for (const m of maps) r2Put(`${version}/sourcemaps/${m.rel}`, m.path, 'application/json');
  console.log(`[ota] archived ${maps.length} sourcemap(s) -> r2://${BUCKET}/${version}/sourcemaps/`);
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
  const confVersion = conf.version;
  if (!confVersion) {
    console.error('error: tauri.conf.json has no `version` — set it before publishing.');
    process.exit(1);
  }
  // tauri.conf.json `version` is the SOURCE OF TRUTH: it is baked into the built app metadata, and is
  // what the updater compares clients against. Publishing a manifest version that differs from the
  // built app causes silent version drift, so OTA_VERSION may only ASSERT the expected version — a
  // mismatch is a hard error unless OTA_ALLOW_VERSION_MISMATCH=1 is set for an emergency override.
  const version = confVersion;
  if (process.env.OTA_VERSION && process.env.OTA_VERSION !== confVersion) {
    const msg =
      `OTA_VERSION (${process.env.OTA_VERSION}) does not match tauri.conf.json version (${confVersion}). ` +
      `The conf version is the source of truth (it is baked into the built app).`;
    if (process.env.OTA_ALLOW_VERSION_MISMATCH === '1') {
      console.warn(`[ota] WARNING: ${msg} OTA_ALLOW_VERSION_MISMATCH=1 set — publishing as v${confVersion} anyway.`);
    } else {
      console.error(
        `error: ${msg} Bump tauri.conf.json (and rebuild), or set OTA_ALLOW_VERSION_MISMATCH=1 to override.`,
      );
      process.exit(1);
    }
  }

  const target = hostTarget();
  const os = target.split('-')[0];
  console.log(`[ota] publishing v${version} for ${target}`);

  const { file, artifactPath, sigPath } = findArtifact(os);
  const signature = readFileSync(sigPath, 'utf8').trim();

  // Safety net: never upload a bundle the shipped app can't verify.
  assertSignatureMatchesUpdaterKey(conf, signature);

  // Namespace the object by version + target so multi-arch artifacts (which often share a filename,
  // e.g. LEDrums.app.tar.gz) never overwrite each other.
  const key = `${version}/${target}/${file}`;
  const url = `${PUBLIC_BASE}/${key}`;

  // Upload the artifact FIRST so the manifest never points ahead of an uploaded file.
  const artifactType = file.endsWith('.zip') ? 'application/zip' : 'application/gzip';
  r2Put(key, artifactPath, artifactType);

  // Archive the web build's hidden sourcemaps for this version (#122) — symbolication capability for
  // every reported stack trace. Done before the manifest so a failed map upload aborts the publish.
  uploadSourcemaps(version);

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
