/**
 * OTA version authority — the guard against releasing a version number twice.
 *
 * THE PROBLEM THIS EXISTS TO SOLVE. `pnpm ota bump` derives the next version from the LOCAL
 * tauri.conf.json. That file is only as fresh as the working tree, and the tree drifts: the bump
 * commit is made locally, `main` is push-protected (ruleset "Block push to main", 2026-07-09), so
 * the commit strands until a pull buries it. The next release then re-derives a number that is
 * ALREADY IN THE WILD. This really happened — v0.2.3 -> v0.2.4 was committed twice (601aa55
 * stranded, 24c63b7 landed), and v0.2.2 vanished the same way.
 *
 * So GIT CANNOT BE THE AUTHORITY on what has shipped. A fresh clone, a second machine, a reset, or
 * a forgotten push all desynchronise it. The authoritative record is the published manifest
 * (`latest.json` in R2) — that is what clients actually see. Every function here compares against
 * THAT, which is why the guard holds regardless of git state.
 *
 * Pure + dependency-injected (`fetchFn`), so the whole decision table is unit-testable offline.
 */

/** @typedef {{version: string, notes?: string, platforms?: Record<string, unknown>}} Manifest */

/** Parse "x.y.z" into numeric fields. Throws on anything else — a malformed version must never
 *  silently compare as equal/greater and let a duplicate release through. */
export function parseVersion(version) {
  const parts = String(version).split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`expected semver version like 0.1.0, got ${version}`);
  }
  const [major, minor, patch] = parts.map(Number);
  return { major, minor, patch };
}

/** Compare two "x.y.z" strings: -1 if a < b, 0 if equal, 1 if a > b. */
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (const field of ['major', 'minor', 'patch']) {
    if (va[field] !== vb[field]) return va[field] < vb[field] ? -1 : 1;
  }
  return 0;
}

/** The next version for `level`, resetting the lower fields (0.2.4 --minor -> 0.3.0). */
export function nextVersion(version, level) {
  const { major, minor, patch } = parseVersion(version);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump level: ${level}`);
}

/**
 * Read the PUBLISHED version from the live manifest. Distinguishes "no releases yet" (a 404 — a
 * legitimate first release) from "could not tell" (network/parse failure), because the two must
 * lead to different decisions: the first may proceed, the second must fail closed.
 *
 * @param {object} args
 * @param {string|undefined} args.publicBase  R2 public base URL (no trailing /latest.json)
 * @param {typeof fetch} [args.fetchFn]
 * @returns {Promise<{reachable: boolean, manifest: Manifest|null, version: string|null, reason?: string}>}
 */
export async function fetchPublishedManifest({ publicBase, fetchFn = fetch }) {
  if (!publicBase) {
    return { reachable: false, manifest: null, version: null, reason: 'OTA_PUBLIC_BASE is not set' };
  }
  const url = `${String(publicBase).replace(/\/+$/, '')}/latest.json`;
  let res;
  try {
    res = await fetchFn(url, { redirect: 'follow' });
  } catch (err) {
    return {
      reachable: false,
      manifest: null,
      version: null,
      reason: `could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  // A 404 is a real answer: the bucket is reachable and nothing has been published yet.
  if (res.status === 404) return { reachable: true, manifest: null, version: null };
  if (!res.ok) {
    return { reachable: false, manifest: null, version: null, reason: `${url} returned ${res.status}` };
  }
  let manifest;
  try {
    manifest = await res.json();
  } catch (err) {
    return {
      reachable: false,
      manifest: null,
      version: null,
      reason: `could not parse ${url}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!manifest || typeof manifest.version !== 'string') {
    return { reachable: false, manifest: null, version: null, reason: `${url} has no string \`version\`` };
  }
  return { reachable: true, manifest, version: manifest.version };
}

/**
 * How the local tree relates to what is actually published. Pure.
 *
 * @returns {'no-releases'|'in-sync'|'local-ahead'|'local-stale'}
 *   no-releases  nothing published yet — anything goes
 *   in-sync      local === published: the normal post-release state
 *   local-ahead  local > published: a bump landed in git but was never published
 *   local-stale  local < published: THE BUG — the tree is behind the wild
 */
export function classifyVersionState({ localVersion, publishedVersion }) {
  if (publishedVersion === null || publishedVersion === undefined) return 'no-releases';
  const cmp = compareVersions(localVersion, publishedVersion);
  if (cmp === 0) return 'in-sync';
  return cmp > 0 ? 'local-ahead' : 'local-stale';
}

/**
 * Decide whether a release may proceed, and what version it produces. THE core guard.
 *
 * A stale tree is refused rather than silently bumped past the published version, because a stale
 * VERSION implies stale CODE — bumping from the remote number would ship an old tree under a fresh
 * version, which is worse than the duplicate it prevents. The operator pulls, then re-runs.
 *
 * @param {object} args
 * @param {string} args.localVersion            tauri.conf.json version (what the build bakes in)
 * @param {string|null} args.publishedVersion   manifest version, or null when nothing is published
 * @param {boolean} args.manifestReachable      false => we could not tell (fail closed)
 * @param {string} args.level                   major|minor|patch
 * @param {boolean} [args.allowUnverified]      OTA_ALLOW_UNVERIFIED_VERSION=1 override
 * @param {string} [args.unreachableReason]
 * @returns {{ok: boolean, next: string|null, state: string, message: string}}
 */
export function planRelease({
  localVersion,
  publishedVersion,
  manifestReachable,
  level,
  allowUnverified = false,
  unreachableReason,
}) {
  if (!manifestReachable) {
    const detail = unreachableReason ? ` (${unreachableReason})` : '';
    if (!allowUnverified) {
      return {
        ok: false,
        next: null,
        state: 'unverified',
        message:
          `cannot verify the published version${detail}. Releasing blind risks re-publishing a version ` +
          `that already exists. Fix connectivity/OTA_PUBLIC_BASE, or set OTA_ALLOW_UNVERIFIED_VERSION=1 ` +
          `to override.`,
      };
    }
    const next = nextVersion(localVersion, level);
    return {
      ok: true,
      next,
      state: 'unverified',
      message:
        `WARNING: could not verify the published version${detail}, and OTA_ALLOW_UNVERIFIED_VERSION=1 ` +
        `is set — releasing v${next} unverified.`,
    };
  }

  const state = classifyVersionState({ localVersion, publishedVersion });

  if (state === 'local-stale') {
    return {
      ok: false,
      next: null,
      state,
      message:
        `local version v${localVersion} is BEHIND the published v${publishedVersion} — this tree is stale. ` +
        `A bump from here would re-mint an already-released number (and would build old code). ` +
        `Run \`git pull\` on main first, then re-run.`,
    };
  }

  const next = nextVersion(localVersion, level);

  // Belt and braces: whatever the classification said, the number we are about to mint must be
  // strictly greater than what is already published. This single assertion catches the whole
  // duplicate-release class, including any case the states above fail to anticipate.
  if (publishedVersion !== null && compareVersions(next, publishedVersion) <= 0) {
    return {
      ok: false,
      next: null,
      state,
      message:
        `refusing to release v${next}: v${publishedVersion} is already published, so this would ` +
        `re-use or move backwards from a released version.`,
    };
  }

  if (state === 'local-ahead') {
    return {
      ok: true,
      next,
      state,
      message:
        `note: local v${localVersion} is ahead of the published v${publishedVersion} — v${localVersion} was ` +
        `bumped but never published. Releasing v${next} skips it (use \`pnpm ota publish\` instead to ` +
        `ship the already-built v${localVersion}).`,
    };
  }

  if (state === 'no-releases') {
    return { ok: true, next, state, message: `no release published yet — releasing v${next}.` };
  }

  return { ok: true, next, state, message: `published v${publishedVersion} -> releasing v${next}.` };
}

/**
 * Why `gh pr merge --auto` failed, so the caller can say something useful. Pure.
 *
 * A repository with auto-merge switched off rejects `--auto` outright — which is exactly what
 * happened on the first live run of the v0.2.12 release: the bump PR opened but never merged, and
 * a version bump sitting in an open PR is the same stranded-bump failure the whole guard exists to
 * prevent. That case is not an error to report, it is a case to FALL BACK from.
 *
 * @param {string} stderr  combined output of the failed `gh pr merge --auto` call
 * @returns {'auto-merge-disabled'|'unknown'}
 */
export function classifyAutoMergeFailure(stderr) {
  const text = String(stderr ?? '');
  return /enablePullRequestAutoMerge|[Aa]uto[- ]merge is not allowed/.test(text)
    ? 'auto-merge-disabled'
    : 'unknown';
}

/**
 * Guard a publish against the live manifest, and classify it for the Discord announcement. Pure.
 *
 * Replaces the old "same-version manifest or nothing" read, which could not tell a normal new
 * release from a manifest that is AHEAD of us — both looked like a fresh release, and both would
 * have owned the @everyone ping.
 *
 * @param {object} args
 * @param {Manifest|null} args.manifest        the live manifest (any version), or null
 * @param {string} args.version                the version being published
 * @param {string} args.target                 platform key, e.g. darwin-aarch64
 * @param {boolean} [args.allowRepublish]      OTA_ALLOW_REPUBLISH=1
 * @param {boolean} [args.allowRollback]       OTA_ALLOW_VERSION_ROLLBACK=1
 * @returns {{ok: boolean, publishKind: 'release'|'platform'|'republish'|null,
 *            mergePlatforms: Record<string, unknown>, notes?: string, message: string}}
 */
export function assessPublish({ manifest, version, target, allowRepublish = false, allowRollback = false }) {
  if (!manifest) {
    return { ok: true, publishKind: 'release', mergePlatforms: {}, message: `first publish of v${version}.` };
  }

  const cmp = compareVersions(manifest.version, version);

  // The live manifest is NEWER than what we are publishing. Uploading would overwrite it and hand
  // every client a downgrade — the loudest possible symptom of a stale tree.
  if (cmp > 0) {
    if (!allowRollback) {
      return {
        ok: false,
        publishKind: null,
        mergePlatforms: {},
        message:
          `refusing to publish v${version}: the live manifest is v${manifest.version}, which is NEWER. ` +
          `Publishing would roll every client back. Pull main and rebuild, or set ` +
          `OTA_ALLOW_VERSION_ROLLBACK=1 if you really mean to roll back.`,
      };
    }
    return {
      ok: true,
      publishKind: 'release',
      mergePlatforms: {},
      message:
        `WARNING: rolling the manifest back from v${manifest.version} to v${version} ` +
        `(OTA_ALLOW_VERSION_ROLLBACK=1).`,
    };
  }

  // Older manifest — an ordinary new release. Its platforms belong to the previous version and are
  // superseded, so they are NOT merged forward.
  if (cmp < 0) {
    return {
      ok: true,
      publishKind: 'release',
      mergePlatforms: {},
      message: `superseding published v${manifest.version} with v${version}.`,
    };
  }

  // Same version. A new platform accumulates into the release (multi-arch built on another machine);
  // the same platform again is a re-publish, which used to be silently allowed.
  const platforms = manifest.platforms ?? {};
  if (platforms[target]) {
    if (!allowRepublish) {
      return {
        ok: false,
        publishKind: null,
        mergePlatforms: {},
        message:
          `refusing to publish v${version} for ${target}: that exact (version, platform) is ALREADY ` +
          `published. Bump the version instead, or set OTA_ALLOW_REPUBLISH=1 to overwrite it ` +
          `deliberately (clients already on v${version} will not re-update).`,
      };
    }
    return {
      ok: true,
      publishKind: 'republish',
      mergePlatforms: platforms,
      notes: manifest.notes,
      message: `re-publishing v${version} for ${target} (OTA_ALLOW_REPUBLISH=1) — overwriting the artifact.`,
    };
  }

  return {
    ok: true,
    publishKind: 'platform',
    mergePlatforms: platforms,
    notes: manifest.notes,
    message: `adding platform ${target} to the published v${version}.`,
  };
}
