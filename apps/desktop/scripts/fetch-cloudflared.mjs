// Fetch the platform `cloudflared` binary into src-tauri/cloudflared/ so Tauri bundles it as
// a resource and the Rust shell can hand its path to the server via LEDRUMS_TUNNEL_BIN.
//
// cloudflared is NOT assumed to be on PATH, and downloading may be network-restricted. This
// script is therefore OPTIONAL: if it can't fetch the binary, the app still builds and runs —
// it just falls back to local/LAN access with no public tunnel (the server already logs a
// friendly "is cloudflared installed?" message and keeps serving).
//
// Usage: node scripts/fetch-cloudflared.mjs

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const outDir = join(desktopDir, 'src-tauri', 'cloudflared');
mkdirSync(outDir, { recursive: true });

const VERSION = process.env.CLOUDFLARED_VERSION || 'latest';
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

const url = `${base}/${assetName}`;
const exeName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const outFile = join(outDir, exeName);

console.log(`[cloudflared] fetching ${url}`);
try {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());

  if (isTgz) {
    // The macOS asset is a gzipped tar containing the `cloudflared` binary; extract via tar.
    const tmpTgz = join(outDir, assetName);
    writeFileSync(tmpTgz, buf);
    execFileSync('tar', ['-xzf', tmpTgz, '-C', outDir], { stdio: 'inherit' });
    rmSync(tmpTgz, { force: true });
    // tar extracts a file literally named `cloudflared`; normalize just in case.
    if (!existsSync(outFile) && existsSync(join(outDir, 'cloudflared'))) {
      renameSync(join(outDir, 'cloudflared'), outFile);
    }
  } else {
    writeFileSync(outFile, buf);
  }
  if (process.platform !== 'win32') chmodSync(outFile, 0o755);
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
