// Fetch the platform `cloudflared` binary into src-tauri/cloudflared/ so Tauri bundles it as
// a resource and the Rust shell can hand its path to the server via LEDRUMS_TUNNEL_BIN.
//
// cloudflared is NOT assumed to be on PATH, and downloading may be network-restricted. This
// script is therefore OPTIONAL: if it can't fetch the binary, the app still builds and runs —
// it just falls back to local/LAN access with no public tunnel (the server already logs a
// friendly "is cloudflared installed?" message and keeps serving).
//
// Usage: node scripts/fetch-cloudflared.mjs [--universal]
//
//   --universal   macOS only: fetch BOTH darwin assets (amd64 + arm64) and `lipo -create` them
//                 into one fat binary, so a universal .app bundles a cloudflared that runs
//                 natively on either architecture. Equivalent: LEDRUMS_CLOUDFLARED_UNIVERSAL=1.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const outDir = join(desktopDir, 'src-tauri', 'cloudflared');
mkdirSync(outDir, { recursive: true });

const universal = process.argv.includes('--universal') || process.env.LEDRUMS_CLOUDFLARED_UNIVERSAL === '1';
if (universal && process.platform !== 'darwin') {
  console.error(`[cloudflared] --universal is macOS-only (lipo); this host is ${process.platform}.`);
  process.exit(1);
}

// Pin a specific release by default (reproducible bundles) — bump as needed, or set
// CLOUDFLARED_VERSION=latest to track the newest.
//
// INTEGRITY. cloudflared publishes no checksum file with its releases (verified 2026-08-10: the
// 2026.6.1 asset list has none), so the hashes below are pinned here. They are NOT bare
// trust-on-first-use: each was downloaded and hashed locally AND independently corroborated
// against GitHub's own server-side release-asset `digest` field
// (`gh api repos/cloudflare/cloudflared/releases/tags/<v> --jq '.assets[].digest'`), which GitHub
// computes at upload time. Two independent sources agree, so a later tampered download is caught.
//
// WHY THE HASHES LIVE HERE, NOT IN THE RELEASE WORKFLOW. The version and its hashes are ONE fact —
// "which cloudflared we ship". Split across two files, bumping PINNED_CLOUDFLARED here would leave
// stale hashes in the workflow: CI fails closed (good) but for a confusing reason, and the fix is
// in a file the bumper wasn't editing. Co-located, a version bump and its hashes are one change in
// one review, and the pin protects LOCAL builds too instead of only CI.
//
// Bumping: change PINNED_CLOUDFLARED, then re-read the digests from the GitHub API command above.
//
// Overrides (env, lowercase hex) win over the pins — for an unreleased build or a bisect:
//   CLOUDFLARED_SHA256                single-asset fetch
//   CLOUDFLARED_SHA256_DARWIN_AMD64   } universal fetch — the hash is PER ASSET, so one variable
//   CLOUDFLARED_SHA256_DARWIN_ARM64   } could not cover both; CLOUDFLARED_SHA256 is ignored there
//                                       (loudly) rather than applied to whichever asset came first
//   CLOUDFLARED_REQUIRE_SHA256=1      refuse to install ANY asset whose hash is unknown. Release CI
//                                       sets this: an unverified binary must never reach a bundle
const PINNED_CLOUDFLARED = '2026.6.1';
const VERSION = process.env.CLOUDFLARED_VERSION || PINNED_CLOUDFLARED;
/** sha256 of each PINNED_CLOUDFLARED asset — see the INTEGRITY note. Bump with the version. */
const PINNED_SHA256 = {
  'cloudflared-darwin-amd64.tgz': 'd7a66b525fe76820da6e5406611b61e48b40de682368ac00454d9158f085be4b',
  'cloudflared-darwin-arm64.tgz': 'f6d4c439c6c782b83264951d327989ce5e23373acc5942b872411601fedb020d',
};
const REQUIRE_SHA256 = process.env.CLOUDFLARED_REQUIRE_SHA256 === '1';
const EXPECTED_SHA256 = process.env.CLOUDFLARED_SHA256?.trim().toLowerCase() || null;
const PER_ARCH_SHA256 = {
  amd64: process.env.CLOUDFLARED_SHA256_DARWIN_AMD64?.trim().toLowerCase() || null,
  arm64: process.env.CLOUDFLARED_SHA256_DARWIN_ARM64?.trim().toLowerCase() || null,
};

/**
 * The sha256 to enforce for one asset: an explicit override first, then the built-in pin — but the
 * built-in pin applies ONLY at PINNED_CLOUDFLARED. Verifying a different version's download against
 * this version's hash would fail for the wrong reason and teach people to switch the check off.
 *
 * @param {string} asset release asset filename
 * @param {string|null} override env-supplied hash for this asset, if any
 * @returns {{sha: string|null, source: string}}
 */
function expectedSha(asset, override) {
  if (override) return { sha: override, source: 'env override' };
  if (VERSION === PINNED_CLOUDFLARED && PINNED_SHA256[asset]) {
    return { sha: PINNED_SHA256[asset], source: `pinned for v${PINNED_CLOUDFLARED}` };
  }
  return { sha: null, source: 'unknown' };
}

const base =
  VERSION === 'latest'
    ? 'https://github.com/cloudflare/cloudflared/releases/latest/download'
    : `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}`;

const archMap = { x64: 'amd64', arm64: 'arm64' };
const arch = archMap[process.arch] ?? process.arch;

let assetName;
let isTgz = false;
if (process.platform === 'darwin') {
  assetName = `cloudflared-darwin-${arch}.tgz`;
  isTgz = true;
} else if (process.platform === 'win32') {
  assetName = `cloudflared-windows-${arch}.exe`;
} else {
  assetName = `cloudflared-linux-${arch}`;
}

const exeName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const outFile = join(outDir, exeName);

/**
 * Download one release asset, enforce its sha256 when one is known, and place the executable at
 * `dest`. Fails closed on a mismatch always, and on an UNKNOWN hash when CLOUDFLARED_REQUIRE_SHA256=1.
 *
 * @param {string} asset          release asset filename
 * @param {boolean} tgz           the asset is a gzipped tar wrapping the binary (the macOS ones are)
 * @param {string|null} override  env-supplied hash for this asset, if any
 * @param {string} dest           where the extracted executable should end up
 * @param {string} label          the env var to name in the "how to pin this" hint
 */
async function installAsset(asset, tgz, override, dest, label) {
  const url = `${base}/${asset}`;
  console.log(`[cloudflared] fetching ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const digest = createHash('sha256').update(buf).digest('hex');
  const { sha, source } = expectedSha(asset, override);
  if (sha) {
    if (digest !== sha) {
      throw new Error(`sha256 MISMATCH for ${asset}: got ${digest}, expected ${sha} (${source})`);
    }
    console.log(`[cloudflared] sha256 verified for ${asset} (${source})`);
  } else if (REQUIRE_SHA256) {
    // Fail closed: the caller declared that an unverified binary must not be installed.
    throw new Error(
      `no known sha256 for ${asset} (version ${VERSION}) and CLOUDFLARED_REQUIRE_SHA256=1. ` +
        `Its actual digest is ${digest} — pin it in PINNED_SHA256 (with the version) or pass ${label}.`,
    );
  } else {
    // NEVER silent: an unverified download is a real weakening of the bundle's integrity story, so
    // it says so in as many words rather than as a passing mention among the progress lines.
    console.warn(
      `\n[cloudflared] ================ WARNING: UNVERIFIED DOWNLOAD ================\n` +
        `[cloudflared] ${asset} (version ${VERSION}) has NO known sha256, so nothing checked what\n` +
        `[cloudflared] was actually downloaded. Its digest is:\n` +
        `[cloudflared]   ${digest}\n` +
        `[cloudflared] Pin it in PINNED_SHA256 alongside the version, or pass ${label}.\n` +
        `[cloudflared] Set CLOUDFLARED_REQUIRE_SHA256=1 to make this a hard failure (release CI does).\n` +
        `[cloudflared] ==============================================================\n`,
    );
  }

  if (tgz) {
    // The macOS asset is a gzipped tar containing the `cloudflared` binary; extract via tar.
    const workDir = dirname(dest);
    const tmpTgz = join(workDir, asset);
    writeFileSync(tmpTgz, buf);
    execFileSync('tar', ['-xzf', tmpTgz, '-C', workDir], { stdio: 'inherit' });
    rmSync(tmpTgz, { force: true });
    // tar extracts a file literally named `cloudflared`; normalize just in case.
    const extracted = join(workDir, 'cloudflared');
    if (!existsSync(dest) && existsSync(extracted)) renameSync(extracted, dest);
  } else {
    writeFileSync(dest, buf);
  }
  if (!existsSync(dest)) throw new Error(`asset ${asset} produced no executable at ${dest}`);
  if (process.platform !== 'win32') chmodSync(dest, 0o755);
}

try {
  if (universal) {
    if (EXPECTED_SHA256) {
      console.warn(
        '[cloudflared] WARNING: CLOUDFLARED_SHA256 is ignored for a universal fetch (two assets, ' +
          'two hashes) — set CLOUDFLARED_SHA256_DARWIN_AMD64 and CLOUDFLARED_SHA256_DARWIN_ARM64.',
      );
    }
    const work = mkdtempSync(join(tmpdir(), 'ledrums-cloudflared-'));
    const slices = [];
    try {
      for (const arch of ['amd64', 'arm64']) {
        const slice = join(work, `cloudflared.${arch}`);
        await installAsset(
          `cloudflared-darwin-${arch}.tgz`,
          true,
          PER_ARCH_SHA256[arch],
          slice,
          `CLOUDFLARED_SHA256_DARWIN_${arch.toUpperCase()}`,
        );
        slices.push(slice);
      }
      rmSync(outFile, { force: true });
      execFileSync('lipo', ['-create', '-output', outFile, ...slices], { stdio: 'inherit' });
      chmodSync(outFile, 0o755);
      const archs = execFileSync('lipo', ['-archs', outFile], { encoding: 'utf8' }).trim();
      console.log(`[cloudflared] universal binary created (${archs})`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  } else {
    await installAsset(assetName, isTgz, EXPECTED_SHA256, outFile, 'CLOUDFLARED_SHA256');
  }
  console.log(`[cloudflared] installed → ${outFile}`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[cloudflared] FAILED: ${msg}`);
  console.error(
    '[cloudflared] The desktop app will still build and run with local/LAN access only. ' +
      'Place a cloudflared binary at ' +
      outFile +
      ' manually to enable the public tunnel.',
  );
  process.exit(1);
}
