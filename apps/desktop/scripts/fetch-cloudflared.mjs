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
// CLOUDFLARED_VERSION=latest to track the newest. cloudflared does not publish per-asset checksum
// files reliably, so verification is opt-in: set CLOUDFLARED_SHA256 to the expected lowercase-hex
// sha256 of the downloaded asset and the script will refuse a mismatch.
//
// The hash is PER ASSET, so a universal fetch (two assets) needs two of them:
// CLOUDFLARED_SHA256_DARWIN_AMD64 / CLOUDFLARED_SHA256_DARWIN_ARM64. `CLOUDFLARED_SHA256` still
// covers the single-asset case; in a universal fetch it would be ambiguous, so it is ignored
// there (with a warning) rather than silently applied to whichever asset came first.
const PINNED_CLOUDFLARED = '2026.6.1';
const VERSION = process.env.CLOUDFLARED_VERSION || PINNED_CLOUDFLARED;
const EXPECTED_SHA256 = process.env.CLOUDFLARED_SHA256?.trim().toLowerCase() || null;
const PER_ARCH_SHA256 = {
  amd64: process.env.CLOUDFLARED_SHA256_DARWIN_AMD64?.trim().toLowerCase() || null,
  arm64: process.env.CLOUDFLARED_SHA256_DARWIN_ARM64?.trim().toLowerCase() || null,
};
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
 * Download one release asset, optionally enforce its sha256, and place the executable at `dest`.
 * @param {string} asset      release asset filename
 * @param {boolean} tgz       the asset is a gzipped tar wrapping the binary (the macOS assets are)
 * @param {string|null} sha   expected lowercase-hex sha256, or null to only report the digest
 * @param {string} dest       where the extracted executable should end up
 * @param {string} label      what to name in log lines / the "set X to enforce" hint
 */
async function installAsset(asset, tgz, sha, dest, label) {
  const url = `${base}/${asset}`;
  console.log(`[cloudflared] fetching ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());

  // Optional integrity check (opt-in per asset — see the env note above).
  const digest = createHash('sha256').update(buf).digest('hex');
  if (sha) {
    if (digest !== sha) throw new Error(`sha256 mismatch for ${asset}: got ${digest}, expected ${sha}`);
    console.log(`[cloudflared] sha256 verified (${asset})`);
  } else {
    console.log(`[cloudflared] sha256 ${digest} for ${asset} (set ${label} to enforce)`);
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
