// Unit tests for the OTA version authority — the guard that makes releasing a version number twice
// impossible. Uses node:test (no extra dependency) so `pnpm -r run test` picks it up. `fetch` is
// injected everywhere; these tests never touch the network.
//
// The cases below are written against the REAL incident: v0.2.3 -> v0.2.4 was committed twice
// (601aa55 stranded by the push-protection ruleset, 24c63b7 landed a day later), so a stale tree
// re-minted a live version number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessPublish,
  classifyAutoMergeFailure,
  classifyVersionState,
  compareVersions,
  fetchPublishedManifest,
  nextVersion,
  parseVersion,
  planRelease,
  resolveReleaseFromTag,
} from './ota-version.mjs';

/** A stub `fetch` returning a canned response for the manifest URL. */
function stubFetch(response) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (typeof response === 'function') return response(url);
    return response;
  };
  fetchFn.calls = calls;
  return fetchFn;
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ---------------------------------------------------------------- semver primitives

test('parseVersion rejects anything that is not x.y.z', () => {
  assert.deepEqual(parseVersion('0.2.11'), { major: 0, minor: 2, patch: 11 });
  for (const bad of ['0.2', '0.2.11-rc1', 'v0.2.11', '', 'x.y.z', '0.2.11.1']) {
    assert.throws(() => parseVersion(bad), /expected semver/, `should reject ${bad}`);
  }
});

test('compareVersions orders numerically, not lexically', () => {
  // The lexical trap: '0.2.9' > '0.2.11' as strings. This is exactly the range the incident sat in.
  assert.equal(compareVersions('0.2.11', '0.2.9'), 1);
  assert.equal(compareVersions('0.2.9', '0.2.11'), -1);
  assert.equal(compareVersions('0.2.4', '0.2.4'), 0);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
});

test('nextVersion resets the lower fields', () => {
  assert.equal(nextVersion('0.2.11', 'patch'), '0.2.12');
  assert.equal(nextVersion('0.2.11', 'minor'), '0.3.0');
  assert.equal(nextVersion('0.2.11', 'major'), '1.0.0');
  assert.throws(() => nextVersion('0.2.11', 'sideways'), /unknown bump level/);
});

test('classifyVersionState names the four situations', () => {
  assert.equal(classifyVersionState({ localVersion: '0.2.4', publishedVersion: null }), 'no-releases');
  assert.equal(classifyVersionState({ localVersion: '0.2.4', publishedVersion: '0.2.4' }), 'in-sync');
  assert.equal(classifyVersionState({ localVersion: '0.2.5', publishedVersion: '0.2.4' }), 'local-ahead');
  assert.equal(classifyVersionState({ localVersion: '0.2.3', publishedVersion: '0.2.4' }), 'local-stale');
});

// ---------------------------------------------------------------- fetching the published version

test('fetchPublishedManifest reads the live manifest version', async () => {
  const fetchFn = stubFetch(jsonResponse({ version: '0.2.11', platforms: { 'darwin-aarch64': {} } }));
  const got = await fetchPublishedManifest({ publicBase: 'https://pub-x.r2.dev/', fetchFn });
  assert.equal(got.reachable, true);
  assert.equal(got.version, '0.2.11');
  // Trailing slash trimmed, no double-slash in the URL.
  assert.equal(fetchFn.calls[0].url, 'https://pub-x.r2.dev/latest.json');
});

test('a 404 manifest means "nothing published yet", not "could not tell"', async () => {
  const got = await fetchPublishedManifest({ publicBase: 'https://pub-x.r2.dev', fetchFn: stubFetch({ ok: false, status: 404 }) });
  assert.equal(got.reachable, true, 'a 404 is a real answer — the bucket responded');
  assert.equal(got.version, null);
});

test('a network failure, a 500, or unparseable JSON is NOT reachable', async () => {
  const boom = await fetchPublishedManifest({
    publicBase: 'https://pub-x.r2.dev',
    fetchFn: async () => { throw new Error('ECONNREFUSED'); },
  });
  assert.equal(boom.reachable, false);
  assert.match(boom.reason, /ECONNREFUSED/);

  const five = await fetchPublishedManifest({ publicBase: 'https://pub-x.r2.dev', fetchFn: stubFetch({ ok: false, status: 500 }) });
  assert.equal(five.reachable, false);

  const garbage = await fetchPublishedManifest({
    publicBase: 'https://pub-x.r2.dev',
    fetchFn: stubFetch({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }),
  });
  assert.equal(garbage.reachable, false);

  const noVersion = await fetchPublishedManifest({ publicBase: 'https://pub-x.r2.dev', fetchFn: stubFetch(jsonResponse({ platforms: {} })) });
  assert.equal(noVersion.reachable, false);
});

test('a cacheBust token bypasses the CDN cache via a unique query string', async () => {
  // The serial multi-arch publish reads latest.json seconds after the previous platform wrote it;
  // a cached stale read would silently drop that platform's entry from the merge.
  const fetchFn = stubFetch(jsonResponse({ version: '0.2.14' }));
  const got = await fetchPublishedManifest({ publicBase: 'https://pub-x.r2.dev', fetchFn, cacheBust: 'run 42' });
  assert.equal(got.version, '0.2.14');
  assert.equal(fetchFn.calls[0].url, 'https://pub-x.r2.dev/latest.json?cb=run%2042');
});

test('an unset OTA_PUBLIC_BASE is unreachable, and makes no request', async () => {
  const fetchFn = stubFetch(jsonResponse({ version: '0.2.11' }));
  const got = await fetchPublishedManifest({ publicBase: undefined, fetchFn });
  assert.equal(got.reachable, false);
  assert.equal(fetchFn.calls.length, 0);
});

// ---------------------------------------------------------------- planRelease: the core guard

test('THE REGRESSION: a stale tree cannot re-mint a published version', () => {
  // Precisely the incident: the tree still says 0.2.3 while 0.2.4 is live. The old code would have
  // happily produced 0.2.4 a second time.
  const plan = planRelease({
    localVersion: '0.2.3',
    publishedVersion: '0.2.4',
    manifestReachable: true,
    level: 'patch',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.state, 'local-stale');
  assert.equal(plan.next, null);
  assert.match(plan.message, /BEHIND the published v0\.2\.4/);
  assert.match(plan.message, /git pull/);
});

test('a stale tree is refused even when the bump would clear the published version', () => {
  // local 0.2.3 + minor -> 0.3.0, which does NOT collide. Still refused: a stale version means stale
  // CODE, so this would ship an old tree under a fresh number.
  const plan = planRelease({
    localVersion: '0.2.3',
    publishedVersion: '0.2.4',
    manifestReachable: true,
    level: 'minor',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.state, 'local-stale');
});

test('the normal in-sync release proceeds', () => {
  const plan = planRelease({
    localVersion: '0.2.11',
    publishedVersion: '0.2.11',
    manifestReachable: true,
    level: 'patch',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'in-sync');
  assert.equal(plan.next, '0.2.12');
});

test('the first-ever release proceeds with nothing published', () => {
  const plan = planRelease({
    localVersion: '0.1.0',
    publishedVersion: null,
    manifestReachable: true,
    level: 'patch',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'no-releases');
  assert.equal(plan.next, '0.1.1');
});

test('local-ahead proceeds but says the skipped version out loud', () => {
  // A bump landed in git but was never published — v0.2.12 exists only in the tree.
  const plan = planRelease({
    localVersion: '0.2.12',
    publishedVersion: '0.2.11',
    manifestReachable: true,
    level: 'patch',
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.state, 'local-ahead');
  assert.equal(plan.next, '0.2.13');
  assert.match(plan.message, /never published/);
  assert.match(plan.message, /pnpm ota publish/);
});

test('an unverifiable manifest fails CLOSED', () => {
  const plan = planRelease({
    localVersion: '0.2.11',
    publishedVersion: null,
    manifestReachable: false,
    level: 'patch',
    unreachableReason: 'ECONNREFUSED',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.state, 'unverified');
  assert.match(plan.message, /ECONNREFUSED/);
  assert.match(plan.message, /OTA_ALLOW_UNVERIFIED_VERSION=1/);
});

test('OTA_ALLOW_UNVERIFIED_VERSION=1 overrides, and still warns', () => {
  const plan = planRelease({
    localVersion: '0.2.11',
    publishedVersion: null,
    manifestReachable: false,
    level: 'patch',
    allowUnverified: true,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.next, '0.2.12');
  assert.match(plan.message, /WARNING/);
});

// ---------------------------------------------------------------- assessPublish: the publish guard

test('THE OTHER REGRESSION: re-publishing the same (version, platform) is refused', () => {
  // This used to be silently allowed — publishKind was just 'republish' and the upload proceeded,
  // overwriting a live artifact that clients would never re-download.
  const got = assessPublish({
    manifest: { version: '0.2.11', platforms: { 'darwin-aarch64': { url: 'x' } } },
    version: '0.2.11',
    target: 'darwin-aarch64',
  });
  assert.equal(got.ok, false);
  assert.equal(got.publishKind, null);
  assert.match(got.message, /ALREADY/);
  assert.match(got.message, /OTA_ALLOW_REPUBLISH=1/);
});

test('OTA_ALLOW_REPUBLISH=1 permits the overwrite and does not re-announce', () => {
  const got = assessPublish({
    manifest: { version: '0.2.11', platforms: { 'darwin-aarch64': { url: 'x' } }, notes: 'keep me' },
    version: '0.2.11',
    target: 'darwin-aarch64',
    allowRepublish: true,
  });
  assert.equal(got.ok, true);
  assert.equal(got.publishKind, 'republish');
  assert.equal(got.notes, 'keep me', 'existing notes survive a re-publish');
});

test('a second architecture accumulates into the same release without a second ping', () => {
  const got = assessPublish({
    manifest: { version: '0.2.11', platforms: { 'darwin-aarch64': { url: 'x' } }, notes: 'release notes' },
    version: '0.2.11',
    target: 'darwin-x86_64',
  });
  assert.equal(got.ok, true);
  assert.equal(got.publishKind, 'platform', 'not "release" — the @everyone ping already fired');
  assert.deepEqual(Object.keys(got.mergePlatforms), ['darwin-aarch64'], 'existing platform merged forward');
  assert.equal(got.notes, 'release notes');
});

test('a newer live manifest blocks the publish rather than rolling clients back', () => {
  const got = assessPublish({
    manifest: { version: '0.2.12', platforms: { 'darwin-aarch64': { url: 'x' } } },
    version: '0.2.11',
    target: 'darwin-aarch64',
  });
  assert.equal(got.ok, false);
  assert.match(got.message, /NEWER/);
  assert.match(got.message, /roll every client back/);
});

test('OTA_ALLOW_VERSION_ROLLBACK=1 permits a deliberate rollback', () => {
  const got = assessPublish({
    manifest: { version: '0.2.12', platforms: { 'darwin-aarch64': { url: 'x' } } },
    version: '0.2.11',
    target: 'darwin-aarch64',
    allowRollback: true,
  });
  assert.equal(got.ok, true);
  assert.equal(got.publishKind, 'release');
  assert.deepEqual(got.mergePlatforms, {}, 'the newer version\'s platforms are not merged into the older one');
});

test('an ordinary new release supersedes the old manifest and does not inherit its platforms', () => {
  const got = assessPublish({
    manifest: { version: '0.2.11', platforms: { 'darwin-aarch64': { url: 'old' } }, notes: 'old notes' },
    version: '0.2.12',
    target: 'darwin-aarch64',
  });
  assert.equal(got.ok, true);
  assert.equal(got.publishKind, 'release', 'owns the @everyone post');
  assert.deepEqual(got.mergePlatforms, {}, 'v0.2.11 artifacts must not appear under v0.2.12');
  assert.equal(got.notes, undefined, 'stale notes are not carried into a new release');
});

test('the very first publish of all is a release', () => {
  const got = assessPublish({ manifest: null, version: '0.1.0', target: 'darwin-aarch64' });
  assert.equal(got.ok, true);
  assert.equal(got.publishKind, 'release');
});

// ---------------------------------------------------------------- resolveReleaseFromTag: the CI release gate

/** The two macOS architectures the release workflow ships. */
const BOTH = ['darwin-x86_64', 'darwin-aarch64'];

/** A resolvable baseline: tag and conf agree, the live manifest is one version behind. */
function resolveArgs(overrides = {}) {
  return {
    tag: 'v0.2.14',
    confVersion: '0.2.14',
    manifest: { version: '0.2.13', platforms: { 'darwin-x86_64': { url: 'x' } } },
    manifestReachable: true,
    platforms: BOTH,
    ...overrides,
  };
}

test('a clean first CI release of a version proceeds for every platform', () => {
  const got = resolveReleaseFromTag(resolveArgs());
  assert.equal(got.ok, true);
  assert.equal(got.state, 'release');
  assert.equal(got.version, '0.2.14');
  assert.deepEqual(got.pendingPlatforms, BOTH, 'both architectures still need publishing');
});

test('the tag is accepted with or without the leading v', () => {
  for (const tag of ['v0.2.14', '0.2.14']) {
    const got = resolveReleaseFromTag(resolveArgs({ tag }));
    assert.equal(got.ok, true, `tag ${tag} should resolve`);
    assert.equal(got.version, '0.2.14');
  }
});

test('a tag that does not parse as a version is refused', () => {
  for (const tag of ['nightly', 'v0.2', 'v0.2.14-rc1', '', 'release-0.2.14']) {
    const got = resolveReleaseFromTag(resolveArgs({ tag }));
    assert.equal(got.ok, false, `tag ${tag} should be refused`);
    assert.equal(got.state, 'invalid-tag');
    assert.equal(got.version, null);
  }
});

test('a tag that disagrees with tauri.conf.json is refused — the build would ship a different version', () => {
  const got = resolveReleaseFromTag(resolveArgs({ tag: 'v0.2.15' }));
  assert.equal(got.ok, false);
  assert.equal(got.state, 'tag-conf-mismatch');
  assert.match(got.message, /tauri\.conf\.json/);
  assert.match(got.message, /0\.2\.14/, 'says what the tree actually carries');
});

test('the second architecture of a half-published version is allowed, pending only the missing platform', () => {
  // x86_64 already live for this version — the resume case after a partial failure, and the case
  // that must NOT re-announce (the @everyone ping already fired; assessPublish derives that).
  const got = resolveReleaseFromTag(
    resolveArgs({ manifest: { version: '0.2.14', platforms: { 'darwin-x86_64': { url: 'x' } } } }),
  );
  assert.equal(got.ok, true);
  assert.equal(got.state, 'partial');
  assert.deepEqual(got.pendingPlatforms, ['darwin-aarch64'], 'only the missing architecture publishes');
});

test('a tag whose every platform is already live is refused', () => {
  const manifest = {
    version: '0.2.14',
    platforms: { 'darwin-x86_64': { url: 'x' }, 'darwin-aarch64': { url: 'y' } },
  };
  const got = resolveReleaseFromTag(resolveArgs({ manifest }));
  assert.equal(got.ok, false);
  assert.equal(got.state, 'already-published');
  assert.match(got.message, /OTA_ALLOW_REPUBLISH=1/);

  // The override still works, and a republish re-publishes every platform.
  const forced = resolveReleaseFromTag(resolveArgs({ manifest, allowRepublish: true }));
  assert.equal(forced.ok, true);
  assert.equal(forced.state, 'republish');
  assert.deepEqual(forced.pendingPlatforms, BOTH);
});

test('a tag older than the published version is refused — a re-run must not roll clients back', () => {
  const manifest = { version: '0.2.15', platforms: { 'darwin-x86_64': { url: 'x' } } };
  const got = resolveReleaseFromTag(resolveArgs({ manifest }));
  assert.equal(got.ok, false);
  assert.equal(got.state, 'rollback');
  assert.match(got.message, /NEWER/);

  const forced = resolveReleaseFromTag(resolveArgs({ manifest, allowRollback: true }));
  assert.equal(forced.ok, true);
  assert.deepEqual(forced.pendingPlatforms, BOTH);
  assert.match(forced.message, /WARNING/);
});

test('an unreadable manifest fails CLOSED, and the unverified override still works', () => {
  const args = resolveArgs({ manifest: null, manifestReachable: false, unreachableReason: 'ECONNREFUSED' });
  const got = resolveReleaseFromTag(args);
  assert.equal(got.ok, false);
  assert.equal(got.state, 'unverified');
  assert.match(got.message, /ECONNREFUSED/);
  assert.match(got.message, /OTA_ALLOW_UNVERIFIED_VERSION=1/);

  const forced = resolveReleaseFromTag({ ...args, allowUnverified: true });
  assert.equal(forced.ok, true);
  assert.deepEqual(forced.pendingPlatforms, BOTH);
  assert.match(forced.message, /WARNING/);
});

test('a 404 manifest is "nothing published yet", not a failure', () => {
  const got = resolveReleaseFromTag(resolveArgs({ manifest: null, manifestReachable: true }));
  assert.equal(got.ok, true);
  assert.equal(got.state, 'release');
  assert.deepEqual(got.pendingPlatforms, BOTH);
});

// ---------------------------------------------------------------- auto-merge fallback

test('a repository with auto-merge switched off is recognised, so the flow can fall back', () => {
  // The verbatim stderr from the first live release (v0.2.12): the bump PR opened, `--auto` was
  // rejected, and the bump sat in an open PR — the stranded-bump failure one step further along.
  assert.equal(
    classifyAutoMergeFailure('GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)'),
    'auto-merge-disabled',
  );
  assert.equal(classifyAutoMergeFailure('enablePullRequestAutoMerge'), 'auto-merge-disabled');
});

test('any other auto-merge failure is not mistaken for the disabled-repo case', () => {
  assert.equal(classifyAutoMergeFailure('HTTP 503: upstream connect error'), 'unknown');
  assert.equal(classifyAutoMergeFailure(''), 'unknown');
  assert.equal(classifyAutoMergeFailure(undefined), 'unknown');
});
