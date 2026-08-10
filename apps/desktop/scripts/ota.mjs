#!/usr/bin/env node
/**
 * LEDrums OTA release driver.
 *
 * One command, changes → deployed:
 *
 *   infisical run --env=prod -- pnpm ota bump [--major|--minor|--patch]
 *
 * `bump` runs the WHOLE pipeline: bump the version → build a signed desktop bundle → publish the
 * updater artifact + manifest to R2. `--patch` is the default; `--minor` / `--major` bump those
 * fields (resetting the lower ones). It must run under `infisical run --env=prod` so the signing
 * key (LEDRUMS_TAURI_SIGNING_PRIVATE_KEY) and R2 creds are present.
 *
 * Sub-commands:
 *   bump [--level] [--dry-run]  full pipeline (bump + build + sign + publish + land the bump PR)
 *                               --dry-run prints the plan without changing/building/publishing
 *   version                     print the current version (read-only)
 *   publish                     publish an already-built signed bundle (e.g. another platform's arch)
 *   doctor                      compare this tree against the published release (read-only)
 *   prepare [--level]           bump the version files ONLY (no build, no publish) — the first step
 *                               of a CI release: commit the bump on a branch, PR it into main, then
 *                               publish by creating a GitHub Release tagged v<version>
 *   ci-plan --tag <vX.Y.Z>      gate a CI release: resolve the release tag against tauri.conf.json
 *                               and the live manifest, emit version/platforms to $GITHUB_OUTPUT
 *                               (read-only — used by .github/workflows/release-ota.yml)
 *
 * NOTE: `bump` is the local FALLBACK path. The normal release route is a GitHub Release, which
 * `.github/workflows/release-ota.yml` builds and publishes for both macOS architectures — see
 * apps/desktop/README.md. Keep `bump` working: a CI outage must not block an urgent fix.
 *
 * VERSION AUTHORITY. The next version is derived from the local tauri.conf.json, but whether a
 * release may happen at all is decided against the LIVE MANIFEST (ota-version.mjs). A tree that is
 * behind what is published is refused outright — that drift is what let v0.2.4 be minted twice
 * (601aa55 stranded, 24c63b7 landed a day later). `pnpm ota doctor` shows the comparison.
 *
 * THE BUMP LANDS BY ITSELF. `main` is push-protected (ruleset "Block push to main"), so the bump is
 * committed on `chore/version-vX.Y.Z` and — only after a SUCCESSFUL publish — pushed as a PR and
 * merged (auto-merge if the repo allows it, otherwise merged outright; see `mergeVersionPr`).
 * Publish-then-PR, never the reverse: if the build or upload fails, main must not claim a version
 * that never shipped.
 *
 * A successful publish announces the release to Discord (#ledrums-updates, @everyone) via
 * ota-announce.mjs — posted only after the manifest is live, so it always means "installable now".
 * That needs LEDRUMS_OTA_UPDATES_DISCORD_WEBHOOK in the environment (hence `--env=prod`); set
 * OTA_ANNOUNCE=0 to publish without announcing.
 *
 * The build signs the updater artifact inline (via with-tauri-signing-env.mjs, which prefers the
 * LEDRUMS_-namespaced key and strips any whitespace the secret store introduced). publish-ota.mjs
 * then verifies the signature was made with the key baked into the app before uploading — so a
 * wrong/rotated signing key aborts the release instead of shipping an unverifiable update.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyAutoMergeFailure,
  classifyVersionState,
  fetchPublishedManifest,
  planRelease,
  resolveReleaseFromTag,
} from './ota-version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, '..');
const repoRoot = resolve(desktopDir, '..', '..');
const tauriConf = join(desktopDir, 'src-tauri', 'tauri.conf.json');
const versionFiles = [
  join(repoRoot, 'package.json'),
  join(repoRoot, 'apps', 'web', 'package.json'),
  join(desktopDir, 'package.json'),
  join(desktopDir, 'src-tauri', 'tauri.conf.json'),
  join(desktopDir, 'src-tauri', 'Cargo.toml'),
  join(desktopDir, 'src-tauri', 'Cargo.lock'),
];

function loadEnvLocal() {
  const envPath = join(repoRoot, '.env.local');
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** Which semver field to bump, from `--major|--minor|--patch` (or bare `major|minor|patch`). */
function parseLevel(args) {
  const levels = ['major', 'minor', 'patch'];
  const found = args.map((a) => a.replace(/^--/, '')).filter((a) => levels.includes(a));
  if (found.length > 1) throw new Error(`pick one of --major/--minor/--patch, got: ${found.join(', ')}`);
  return found[0] ?? 'patch';
}

function bumpVersion(version, level) {
  const parts = version.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new Error(`expected semver version like 0.1.0, got ${version}`);
  }
  let [major, minor, patch] = parts.map(Number);
  if (level === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (level === 'minor') [major, minor, patch] = [major, minor + 1, 0];
  else [major, minor, patch] = [major, minor, patch + 1];
  return `${major}.${minor}.${patch}`;
}

function updateJsonVersion(file, next) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = next;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function updateCargoVersion(file, next) {
  const text = readFileSync(file, 'utf8');
  if (!/^version = "[^"]+"/m.test(text)) throw new Error(`could not find package version in ${file}`);
  writeFileSync(file, text.replace(/^version = "[^"]+"/m, `version = "${next}"`));
}

function updateCargoLockPackageVersion(file, packageName, next) {
  const text = readFileSync(file, 'utf8');
  const block = new RegExp(`(\\[\\[package\\]\\]\\nname = "${packageName}"\\nversion = ")[^"]+(")`);
  if (!block.test(text)) throw new Error(`could not find ${packageName} package version in ${file}`);
  writeFileSync(file, text.replace(block, `$1${next}$2`));
}

function relativePath(file) {
  return file.startsWith(`${repoRoot}/`) ? file.slice(repoRoot.length + 1) : file;
}

function runGit(args, errorMessage) {
  const child = spawnSync('git', args, { cwd: repoRoot, stdio: 'inherit' });
  if (child.status !== 0) {
    throw new Error(`${errorMessage} (git ${args.join(' ')})`);
  }
}

/** Run a git command for its OUTPUT, returning null when it fails (for read-only probes). */
function gitOut(args) {
  const child = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return child.status === 0 ? child.stdout.trim() : null;
}

function ensureCleanWorkingTree() {
  const child = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  if (child.status !== 0) {
    throw new Error('could not inspect git working tree before OTA bump');
  }
  if (child.stdout.trim()) {
    throw new Error('cannot run OTA bump with a dirty working tree; commit, stash, or discard local changes first');
  }
}

/** The branch the operator started on — where we return once the release is out. */
function currentBranch() {
  return gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
}

/**
 * How the current branch stands against its upstream, after a fetch. `behind > 0` is the condition
 * that produced the duplicate-release incident: releasing from a branch that is missing commits
 * (including, historically, an earlier stranded version bump) bakes a stale tree into the build.
 */
function upstreamDivergence() {
  // A fetch failure is not fatal — the manifest check is the real authority; this is a hint.
  spawnSync('git', ['fetch', 'origin', '--quiet'], { cwd: repoRoot, stdio: 'ignore' });
  const counts = gitOut(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (!counts) return null;
  const [ahead, behind] = counts.split(/\s+/).map(Number);
  return { ahead, behind };
}

/** The version-bump branch for a release — a PR target, since `main` refuses direct pushes. */
function versionBranchName(next) {
  return `chore/version-v${next}`;
}

function commitVersionBump(current, next) {
  const paths = versionFiles.map(relativePath);
  runGit(['add', ...paths], 'could not stage OTA version files');
  runGit(['commit', '-m', `version bump: v${current} -> v${next}`], 'could not commit OTA version bump');
}

/**
 * Get the version bump onto `main` WITHOUT the operator having to remember anything.
 *
 * `main` is push-protected (ruleset "Block push to main"), so the bump commit used to be made
 * locally and then stranded when the manual push bounced — the exact mechanism that let v0.2.4 be
 * minted twice. The ruleset requires a PR but zero approvals, so the script can open one and let it
 * auto-merge.
 *
 * Called only AFTER a successful publish: if the build or upload fails, main must not claim a
 * version that never shipped. Best-effort by the same logic as the Discord announcement — the
 * release has already landed, so a `gh` failure WARNS with the manual steps rather than failing.
 */
function openVersionBumpPr({ current, next, branch, originalBranch }) {
  const push = spawnSync('git', ['push', '-u', 'origin', branch], { cwd: repoRoot, stdio: 'inherit' });
  if (push.status !== 0) {
    console.warn(
      `[ota] WARNING: could not push ${branch} — the v${next} bump is COMMITTED LOCALLY ONLY.\n` +
        `      Push it and open a PR by hand, or the next release will re-mint v${next}:\n` +
        `        git push -u origin ${branch} && gh pr create --fill && gh pr merge --auto --merge`,
    );
    return false;
  }

  const title = `chore: version bump v${current} -> v${next}`;
  const body =
    `Released v${next} over the air.\n\n` +
    `Opened automatically by \`pnpm ota bump\` after a successful publish, so the version bump ` +
    `cannot strand locally (\`main\` refuses direct pushes).\n`;
  const pr = spawnSync('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', body], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (pr.status !== 0) {
    console.warn(
      `[ota] WARNING: pushed ${branch} but could not open a PR. Open one to land the v${next} bump:\n` +
        `        gh pr create --base main --head ${branch} --fill && gh pr merge --auto --merge`,
    );
    return false;
  }

  if (!mergeVersionPr(branch, next)) return false;

  returnToBranch(originalBranch);
  return true;
}

/**
 * Merge the version-bump PR: prefer auto-merge, but FALL BACK to merging outright.
 *
 * Auto-merge is a per-repository setting, and this repo has it switched off — the first live run
 * (v0.2.12) opened the PR, got `enablePullRequestAutoMerge` rejected, and left the bump sitting in
 * an open PR. That is the same stranded-bump failure the version guard exists to prevent, just one
 * step further along, so "auto-merge is unavailable" must not be where the flow gives up.
 *
 * Falling back is safe here: the merge still goes through GitHub, so the `main` ruleset (and any
 * required checks it grows later) is enforced server-side — a fallback merge can never bypass a
 * gate that a `--auto` merge would have waited for.
 */
function mergeVersionPr(branch, next) {
  const auto = spawnSync('gh', ['pr', 'merge', branch, '--auto', '--merge'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (auto.status === 0) {
    console.log(`[ota] opened + auto-merging the v${next} version-bump PR (${branch}) ✓`);
    return true;
  }

  const reason = classifyAutoMergeFailure(`${auto.stderr ?? ''}${auto.stdout ?? ''}`);
  console.log(
    reason === 'auto-merge-disabled'
      ? `[ota] auto-merge is disabled for this repository — merging the v${next} bump PR directly instead.`
      : `[ota] could not enable auto-merge (${(auto.stderr ?? '').trim() || 'unknown reason'}) — trying a direct merge.`,
  );

  const direct = spawnSync('gh', ['pr', 'merge', branch, '--merge'], { cwd: repoRoot, stdio: 'inherit' });
  if (direct.status !== 0) {
    console.warn(
      `[ota] WARNING: the v${next} bump PR (${branch}) is OPEN and UNMERGED. Until it lands, main still\n` +
        `      reads the previous version and the next release could re-mint v${next}. Merge it:\n` +
        `        gh pr merge ${branch} --merge`,
    );
    return false;
  }

  console.log(`[ota] merged the v${next} version-bump PR (${branch}) ✓`);
  return true;
}

/**
 * Return to the branch the operator started on and fast-forward it, so the NEXT release does not
 * start from a tree that is missing the bump we just landed. Advisory: a failure here is reported,
 * never fatal — and the manifest guard catches the consequence anyway.
 */
function returnToBranch(originalBranch) {
  if (!originalBranch || originalBranch === 'HEAD') return;
  const checkout = spawnSync('git', ['checkout', originalBranch], { cwd: repoRoot, stdio: 'inherit' });
  if (checkout.status !== 0) {
    console.warn(`[ota] WARNING: could not switch back to ${originalBranch} — you are still on the bump branch.`);
    return;
  }
  const pull = spawnSync('git', ['pull', '--ff-only'], { cwd: repoRoot, stdio: 'inherit' });
  if (pull.status !== 0) {
    console.warn(
      `[ota] NOTE: back on ${originalBranch}, but it could not fast-forward yet (the bump PR may still be ` +
        `merging). Run \`git pull\` before the next release.`,
    );
  }
}

/** Bump the app version across web + desktop metadata. tauri.conf.json remains OTA source of truth. */
function bumpFiles(level) {
  const current = JSON.parse(readFileSync(tauriConf, 'utf8')).version;
  const next = bumpVersion(current, level);
  updateJsonVersion(tauriConf, next);
  updateJsonVersion(join(repoRoot, 'package.json'), next);
  updateJsonVersion(join(repoRoot, 'apps', 'web', 'package.json'), next);
  updateJsonVersion(join(desktopDir, 'package.json'), next);
  updateCargoVersion(join(desktopDir, 'src-tauri', 'Cargo.toml'), next);
  updateCargoLockPackageVersion(join(desktopDir, 'src-tauri', 'Cargo.lock'), 'ledrums-desktop', next);
  console.log(`[ota] bumped app version ${current} -> ${next} (${level})`);
  return next;
}

/** Build a signed desktop bundle. Signing env is set up by with-tauri-signing-env.mjs. */
function build() {
  console.log('[ota] building signed desktop bundle (tauri build)…');
  const child = spawnSync(
    process.execPath,
    [join(desktopDir, 'scripts', 'with-tauri-signing-env.mjs'), 'pnpm', '--filter', '@ledrums/desktop', 'build'],
    { cwd: repoRoot, env: process.env, stdio: 'inherit' },
  );
  if (child.status !== 0) {
    console.error('[ota] build failed — aborting release (version files are already bumped).');
    process.exit(child.status ?? 1);
  }
}

/** The R2 public base URL, from the environment or .env.local. */
function publicBase() {
  loadEnvLocal();
  return process.env.OTA_PUBLIC_BASE || process.env.BASE;
}

/** Publish the freshly-built signed artifact + manifest, returning the exit status. publish-ota.mjs
 *  guards against the live manifest and verifies the signature key id against the app's baked-in
 *  updater pubkey before uploading anything. */
function runPublish() {
  const base = publicBase();
  if (!base) {
    console.error('error: set BASE or OTA_PUBLIC_BASE in .env.local (the R2 public base URL)');
    return 1;
  }
  const env = { ...process.env, OTA_PUBLIC_BASE: base };
  const child = spawnSync(process.execPath, [join(desktopDir, 'scripts', 'publish-ota.mjs')], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  return child.status ?? 1;
}

/** The `publish` sub-command: publish an already-built bundle, then exit with its status. */
function publish() {
  process.exit(runPublish());
}

/** The current desktop version (tauri.conf.json is the source of truth). */
function currentVersion() {
  return JSON.parse(readFileSync(tauriConf, 'utf8')).version;
}

/** What is actually published right now, per the live manifest — the authority on what has shipped.
 *  Cache-busted so the answer is the manifest as it IS, not as the CDN last cached it. */
async function published() {
  return fetchPublishedManifest({ publicBase: publicBase(), cacheBust: Date.now().toString(36) });
}

/**
 * Report how this tree stands against the wild: local version vs published version, and whether the
 * branch is behind its upstream. Cheap, read-only, and it makes the drift that caused the duplicate
 * v0.2.4 release VISIBLE before it bites.
 */
async function doctor() {
  const local = currentVersion();
  console.log(`[ota] local version (tauri.conf.json):  v${local}`);

  const live = await published();
  if (!live.reachable) {
    console.log(`[ota] published version:                UNKNOWN — ${live.reason}`);
  } else if (live.version === null) {
    console.log('[ota] published version:                none (nothing released yet)');
  } else {
    console.log(`[ota] published version (latest.json):  v${live.version}`);
  }

  const branch = currentBranch();
  const div = upstreamDivergence();
  console.log(
    `[ota] branch:                           ${branch ?? 'unknown'}` +
      (div ? ` (${div.ahead} ahead, ${div.behind} behind upstream)` : ' (no upstream)'),
  );

  const state = live.reachable ? classifyVersionState({ localVersion: local, publishedVersion: live.version }) : null;
  if (state === 'local-stale') {
    console.error(
      `\n[ota] PROBLEM: this tree (v${local}) is BEHIND the published v${live.version}. A release from here ` +
        `would re-mint a live version number. Run \`git pull\` on main first.`,
    );
    return 1;
  }
  if (state === 'local-ahead') {
    console.warn(
      `\n[ota] NOTE: v${local} is bumped in the tree but never published. \`pnpm ota publish\` ships it; ` +
        `\`pnpm ota bump\` would skip past it.`,
    );
  }
  if (div && div.behind > 0) {
    console.warn(`\n[ota] NOTE: ${branch} is ${div.behind} commit(s) behind upstream — pull before releasing.`);
  }
  if (state === 'in-sync' && (!div || div.behind === 0)) console.log('\n[ota] all good — ready to release.');
  return 0;
}

/** True if any `--dry-run` / `--dryrun` flag is present. */
function hasDryRun(args) {
  return args.some((a) => a === '--dry-run' || a === '--dryrun');
}

/**
 * The `prepare` sub-command: bump the version files for a CI release — and nothing else.
 *
 * The CI release flow needs the repo's version files to ALREADY carry the new version before the
 * GitHub Release is created (the tag-vs-tauri.conf.json gate refuses otherwise), so the bump lands
 * through an ordinary PR. Same layer-1 guard as `bump`: the live manifest decides whether a release
 * may proceed, so a stale tree still cannot re-mint a shipped version. Building, publishing, and
 * announcing all belong to the release workflow after the Release is created.
 */
async function prepare(level) {
  const current = currentVersion();
  const live = await published();
  const plan = planRelease({
    localVersion: current,
    publishedVersion: live.version,
    manifestReachable: live.reachable,
    level,
    allowUnverified: process.env.OTA_ALLOW_UNVERIFIED_VERSION === '1',
    unreachableReason: live.reason,
  });
  if (!plan.ok) {
    console.error(`error: ${plan.message}`);
    process.exit(1);
  }
  console.log(`[ota] ${plan.message}`);
  const next = bumpFiles(level);
  console.log(
    `\n[ota] version files now read v${next}. Nothing was built or published. Next:\n` +
      `  1. commit these changes on a branch and open a PR into main\n` +
      `  2. merge the PR\n` +
      `  3. publish by creating a GitHub Release tagged v${next} — the release workflow builds,\n` +
      `     signs, publishes to R2, and announces (see apps/desktop/README.md "Release flow")`,
  );
}

/** The value following `--<name>` in an argv list, or undefined. */
function flagValue(args, name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

/** The macOS architectures the release workflow ships (Tauri updater platform keys). */
const CI_PLATFORMS = ['darwin-x86_64', 'darwin-aarch64'];

/**
 * The `ci-plan` sub-command: the release workflow's gate. Read-only.
 *
 * Resolves a GitHub Release tag against the local tauri.conf.json and the LIVE manifest
 * (resolveReleaseFromTag — all branching lives in the pure module; this and the workflow only
 * orchestrate). Prints the decision; on refusal exits 1 so the workflow stops before building
 * anything. On success, writes `version` and the space-separated `platforms` still needing a
 * publish to $GITHUB_OUTPUT for the publish job to iterate over.
 */
async function ciPlan(rest) {
  const tag = flagValue(rest, 'tag');
  if (!tag) {
    console.error('usage: pnpm ota ci-plan --tag <vX.Y.Z> [--platforms darwin-x86_64,darwin-aarch64]');
    process.exit(2);
  }
  const platforms = (flagValue(rest, 'platforms') ?? CI_PLATFORMS.join(','))
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const live = await published();
  const plan = resolveReleaseFromTag({
    tag,
    confVersion: currentVersion(),
    manifest: live.manifest,
    manifestReachable: live.reachable,
    unreachableReason: live.reason,
    platforms,
    allowRepublish: process.env.OTA_ALLOW_REPUBLISH === '1',
    allowRollback: process.env.OTA_ALLOW_VERSION_ROLLBACK === '1',
    allowUnverified: process.env.OTA_ALLOW_UNVERIFIED_VERSION === '1',
  });

  if (!plan.ok) {
    console.error(`error: ${plan.message}`);
    process.exit(1);
  }
  console.log(`[ota] ${plan.message}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${plan.version}\nplatforms=${plan.pendingPlatforms.join(' ')}\n`,
    );
  }
}

/**
 * The everyday release: guard → bump → commit on a branch → build (sign) → publish → land the bump
 * via PR. `--dry-run` prints the plan (including the live-manifest check) and changes nothing.
 *
 * The version number comes from the local tree, but the DECISION to release comes from the live
 * manifest (see ota-version.mjs) — that is what stops a stale checkout re-minting a shipped version.
 */
async function release(level, dryRun) {
  const current = currentVersion();

  // Layer 1: the live manifest, not this tree, decides whether a release may proceed.
  const live = await published();
  const plan = planRelease({
    localVersion: current,
    publishedVersion: live.version,
    manifestReachable: live.reachable,
    level,
    allowUnverified: process.env.OTA_ALLOW_UNVERIFIED_VERSION === '1',
    unreachableReason: live.reason,
  });
  if (!plan.ok) {
    console.error(`error: ${plan.message}`);
    process.exit(1);
  }
  const next = plan.next;
  const branch = versionBranchName(next);
  const originalBranch = currentBranch();

  if (dryRun) {
    console.log(`[ota] DRY RUN — would release ${current} -> ${next} (${level}):`);
    console.log(`  0. ${plan.message}`);
    const div = upstreamDivergence();
    if (div && div.behind > 0) {
      console.log(`     WARNING: ${originalBranch} is ${div.behind} commit(s) behind upstream — pull first.`);
    }
    console.log('  1. require a clean git working tree');
    console.log('  2. bump app versions in root package.json, apps/web/package.json, desktop package.json, tauri.conf.json, Cargo.toml, Cargo.lock');
    console.log(`  3. commit on branch ${branch}: version bump: v${current} -> v${next}`);
    console.log('  4. build a signed desktop bundle (tauri build)');
    console.log("  5. verify the signature key matches the app's updater pubkey");
    console.log('  6. publish the artifact + manifest to R2 (refused if that version+platform is already live)');
    console.log(
      process.env.OTA_ANNOUNCE === '0'
        ? '  7. (announcement skipped: OTA_ANNOUNCE=0)'
        : `  7. announce v${next} to Discord (@everyone)${
            process.env.LEDRUMS_OTA_UPDATES_DISCORD_WEBHOOK ? '' : ' — WEBHOOK NOT SET, would warn and skip'
          }`,
    );
    console.log(`  8. push ${branch} + open an auto-merging PR so the bump lands on main`);
    console.log('[ota] dry run — nothing was changed, built, or published.');
    return;
  }

  if (plan.message) console.log(`[ota] ${plan.message}`);
  ensureCleanWorkingTree();

  // Commit the bump on its own branch: `main` refuses direct pushes, so a bump committed onto a
  // local main can only ever strand there.
  runGit(['checkout', '-b', branch], `could not create the version branch ${branch}`);
  bumpFiles(level);
  commitVersionBump(current, next);

  build();

  const status = runPublish();
  if (status !== 0) {
    console.error(
      `[ota] publish failed — v${next} was NOT released. The bump is committed on ${branch} but no PR was ` +
        `opened, so main still reads v${current}. Fix the cause and re-run, or delete the branch.`,
    );
    process.exit(status);
  }

  // Only now — the release is live, so main may claim it. Layer 2: this is what stops the bump
  // stranding locally and a later release re-minting v${next}.
  openVersionBumpPr({ current, next, branch, originalBranch });
}

// No default sub-command: a bare `pnpm ota` prints usage. `bump` starts a full build-and-publish
// release pipeline, which must never be the accidental outcome of an incomplete command.
const [, , command, ...rest] = process.argv;

try {
  if (command === 'bump') await release(parseLevel(rest), hasDryRun(rest));
  else if (command === 'version') console.log(currentVersion());
  else if (command === 'publish') publish();
  else if (command === 'doctor') process.exit(await doctor());
  else if (command === 'prepare') await prepare(parseLevel(rest));
  else if (command === 'ci-plan') await ciPlan(rest);
  else {
    console.error('usage: pnpm ota <bump|version|publish|doctor|prepare|ci-plan> [--major|--minor|--patch] [--dry-run]');
    console.error('  prepare   bump the version files only (commit via PR, then publish via a GitHub Release)');
    console.error('  bump      bump + build + sign + publish + land the bump PR  (run under `infisical run --env=prod`)');
    console.error('  bump --dry-run   print the release plan without changing anything');
    console.error('  version   print the current version');
    console.error('  publish   publish an already-built signed bundle');
    console.error('  doctor    compare this tree against the published release (read-only)');
    console.error('  ci-plan --tag <vX.Y.Z>   gate a CI release: resolve the tag against the live manifest (read-only)');
    process.exit(2);
  }
} catch (err) {
  console.error(`error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
