// One SEA version source for setup-node, the blob generator and every injected runtime.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PINNED_NODE_VERSION = readFileSync(new URL('../.node-version', import.meta.url), 'utf8').trim();
if (!/^\d+\.\d+\.\d+$/.test(PINNED_NODE_VERSION)) {
  throw new Error('apps/desktop/.node-version must contain one exact Node version (x.y.z).');
}

/** Call before creating build artifacts. Universal and CI builds have no version fallback. */
export function assertSeaBuildEnvironment({
  version = process.versions.node,
  universal = false,
  ci = Boolean(process.env.CI && process.env.CI !== 'false') || process.env.GITHUB_ACTIONS === 'true',
  override = process.env.LEDRUMS_SEA_NODE_VERSION,
  skipSidecar = process.env.PREPARE_SKIP_SIDECAR === '1',
} = {}) {
  if (override && override.replace(/^v/, '') !== PINNED_NODE_VERSION) {
    throw new Error(
      `LEDRUMS_SEA_NODE_VERSION cannot override the SEA pin. Change apps/desktop/.node-version ` +
      `in a reviewed commit instead (currently v${PINNED_NODE_VERSION}).`,
    );
  }
  if ((universal || ci) && skipSidecar) {
    throw new Error('PREPARE_SKIP_SIDECAR is local host-only; universal/CI builds must regenerate the pinned SEA.');
  }
  if ((universal || ci) && version !== PINNED_NODE_VERSION) {
    throw new Error(
      `SEA Node version mismatch: active v${version}, required v${PINNED_NODE_VERSION}. ` +
      `Universal/CI builds require exact generator/runtime parity before creating artifacts. ` +
      `Activate the version in apps/desktop/.node-version and retry.`,
    );
  }
}

/** Foreign-arch cache evidence: the receipt is created only after official archive verification. */
export function matchesNodeCacheReceipt(name, bytes, receipt) {
  return receipt?.name === name && receipt.sha256 === createHash('sha256').update(bytes).digest('hex');
}

function readNodeVersion(path) {
  return execFileSync(path, ['--version'], { encoding: 'utf8' }).trim().replace(/^v/, '');
}

/**
 * Host-only local builds may download the pin when launched from another Node version. If that
 * download is unavailable, retain the historical even-major offline fallback, but generate AND
 * inject using the very same executable. That path is explicitly non-reproducible, never CI or
 * universal. A fetched executable reporting the wrong version fails, never falls back.
 */
export async function resolveSeaNode({
  fetchNode,
  version = process.versions.node,
  execPath = process.execPath,
  universal = false,
  ci,
  override,
  readVersion = readNodeVersion,
  warn = console.warn,
}) {
  assertSeaBuildEnvironment({ version, universal, ci, override });
  let path = execPath;
  let expected = PINNED_NODE_VERSION;
  let source = 'active';
  if (version !== PINNED_NODE_VERSION) {
    try {
      path = await fetchNode();
      source = 'pinned';
    } catch (error) {
      const major = Number(version.split('.')[0]);
      if (major < 20 || major % 2 !== 0) {
        throw new Error(
          `Cannot fetch pinned SEA Node v${PINNED_NODE_VERSION} (${error.message}); active v${version} ` +
          `is not an even-major LTS fallback. Restore connectivity or activate the pinned version.`,
        );
      }
      expected = version;
      source = 'local-fallback';
      warn(
        `[sidecar] WARNING: NON-REPRODUCIBLE local host-only fallback: cannot fetch pinned Node ` +
        `(${error.message}). Both SEA generator and runtime will use active v${version}. ` +
        `Universal and CI builds never permit this fallback.`,
      );
    }
  }
  const actual = readVersion(path);
  if (actual !== expected) {
    throw new Error(`SEA Node version mismatch: ${path} reports v${actual}, expected v${expected}. Clear apps/desktop/.node-pin/ and retry.`);
  }
  return { path, version: actual, source };
}
