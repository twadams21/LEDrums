import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../../../.github/workflows/release-ota.yml', import.meta.url), 'utf8');
// Deliberately inspect the actual workflow, not a second copy of its shell commands. These
// narrow readers fail if the expected job/step shape disappears; no YAML dependency needed.
function job(name) {
  const body = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z]+:|$(?![\\s\\S]))`, 'm').exec(workflow)?.[1];
  assert.ok(body, `missing job ${name}`);
  return body;
}
function resolver() {
  const body = /id: source\n\s+shell: bash\n\s+run: \|\n((?: {10}.+\n)+)/.exec(job('plan'))?.[1];
  assert.ok(body, 'missing inline tag resolver');
  return body.replace(/^ {10}/gm, '');
}
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'release-source-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'origin.git');
  git(root, 'init', repo);
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  git(repo, 'config', 'user.name', 'Release fixture');
  writeFileSync(join(repo, 'tauri.conf.json'), '{"version":"0.3.0"}\n');
  writeFileSync(join(repo, 'helper.txt'), 'tag helper\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'requested release');
  const tagSha = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'tag', 'v0.3.0');
  git(repo, 'tag', '0.3.0');
  git(repo, 'tag', '-a', 'v0.3.1', '-m', 'annotated fixture');
  writeFileSync(join(repo, 'helper.txt'), 'unrelated dispatch helper\n');
  git(repo, 'commit', '-am', 'different code, same version');
  const dispatchSha = git(repo, 'rev-parse', 'HEAD');
  function resolve(tag) {
    const output = join(root, 'output');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-c', resolver()], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_TAG: tag,
        RUNNER_TEMP: root,
        GITHUB_SERVER_URL: pathToFileURL(root).href,
        GITHUB_REPOSITORY: 'origin',
        GITHUB_OUTPUT: output,
        GITHUB_REF: 'refs/heads/dispatch',
        GITHUB_SHA: dispatchSha,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    return { ...result, output: readFileSync(output, 'utf8') };
  }
  return { root, repo, tagSha, dispatchSha, resolve };
}

test('every release checkout and source assertion uses the single resolved commit', () => {
  const expected = { plan: 'steps.source.outputs.sha', build: 'needs.plan.outputs.sha', publish: 'needs.plan.outputs.sha' };
  assert.equal((workflow.match(/uses: actions\/checkout@/g) ?? []).length, 3);
  assert.match(job('plan'), /sha: \$\{\{ steps.source.outputs.sha \}\}/);
  for (const [name, source] of Object.entries(expected)) {
    const body = job(name);
    assert.ok(body.includes(`ref: \${{ ${source} }}`), `${name} checkout must use SHA`);
    assert.ok(body.includes(`RELEASE_SHA: \${{ ${source} }}`), `${name} assertion must use SHA`);
    assert.match(body, /persist-credentials: false/);
    assert.match(body, /run: test "\$\(git rev-parse HEAD\)" = "\$RELEASE_SHA"/);
    assert.ok(body.indexOf('name: Verify release checkout') < body.indexOf('uses: actions/setup-node'));
    assert.doesNotMatch(body, /ref:.*(?:github\.ref|github\.sha|inputs\.|RELEASE_TAG)/);
  }
  assert.match(job('build'), /needs: plan/);
  assert.match(job('publish'), /needs: \[plan, build\]/);
  assert.ok(job('plan').indexOf('id: source') < job('plan').indexOf('uses: actions/checkout'));
  assert.doesNotMatch(resolver(), /node |pnpm |github\.sha|github\.ref|scripts\//);
});

test('same-version dispatch cannot substitute source or publish helpers; tag moves do not change the planned SHA', (t) => {
  const f = fixture(t);
  const result = f.resolve('v0.3.0');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, `sha=${f.tagSha}\n`);
  assert.notEqual(f.tagSha, f.dispatchSha);
  // Move the mutable name AFTER planning, just as could happen between Actions jobs.
  git(f.repo, 'tag', '-f', 'v0.3.0', f.dispatchSha);
  const checkout = join(f.root, 'checkout');
  git(f.root, 'clone', '--no-checkout', f.repo, checkout);
  git(checkout, 'checkout', '--detach', f.tagSha);
  assert.equal(readFileSync(join(checkout, 'helper.txt'), 'utf8'), 'tag helper\n');
  const guard = /run: (test "\$\(git rev-parse HEAD\)" = "\$RELEASE_SHA")/.exec(job('publish'))[1];
  const verify = (sha) => spawnSync('bash', ['-c', guard], {
    cwd: checkout, env: { ...process.env, RELEASE_SHA: sha },
  }).status;
  assert.equal(verify(f.tagSha), 0);
  assert.notEqual(verify(f.dispatchSha), 0, 'same version is not commit identity');
});

test('unprefixed version tags retain the existing version-gate compatibility', (t) => {
  const f = fixture(t);
  const result = f.resolve('0.3.0');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, `sha=${f.tagSha}\n`);
});

test('annotated tags resolve to the commit, not the tag object', (t) => {
  const f = fixture(t);
  assert.notEqual(git(f.repo, 'rev-parse', 'refs/tags/v0.3.1'), f.tagSha);
  const result = f.resolve('v0.3.1');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, `sha=${f.tagSha}\n`);
});

test('missing tag refuses even when a same-named branch exists', (t) => {
  const f = fixture(t);
  git(f.repo, 'branch', 'v0.3.2');
  const result = f.resolve('v0.3.2');
  assert.notEqual(result.status, 0);
  assert.equal(result.output, '');
});

test('invalid/ref-like/injected tags refuse before fetching and emit no SHA', (t) => {
  const f = fixture(t);
  for (const tag of ['', 'main', 'refs/tags/v0.3.0', '--help', 'v0.3.0\nsha=bad', 'v0.3.0; echo injected']) {
    const result = f.resolve(tag);
    assert.notEqual(result.status, 0, tag);
    assert.match(result.stderr, /Invalid release tag/);
    assert.equal(result.output, '');
  }
});

test('release keeps dry-run default, universal artifact, serial publishing and no CI overrides', () => {
  assert.match(workflow, /dry_run:[\s\S]*?default: true/);
  assert.match(job('publish'), /OTA_DRY_RUN:.*inputs.dry_run/);
  assert.match(job('build'), /build:universal/);
  assert.match(job('build'), /LEDRUMS_UNIVERSAL_REQUIRE: cloudflared/);
  assert.match(job('publish'), /for target in \$PLATFORMS; do/);
  assert.match(job('publish'), /OTA_BUNDLE_DIR="ota-artifacts\/universal"/);
  assert.doesNotMatch(job('publish'), /strategy:|matrix:/);
  assert.doesNotMatch(workflow, /^\s+OTA_ALLOW_\w+:/m);
});
