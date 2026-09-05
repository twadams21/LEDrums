# P12 + P13 — release reproducibility

Source: Trent's implementation request for P12/P13 in
`docs/plans/2026-09-05-codebase-health-audit.md`. Branch: `fix/health-release-repro`,
base `ea18f61` (merged audit PR #202). Implementation is authorized; publication and
infrastructure deployment are not.

## P12 — immutable release source

The workflow resolves the exact requested tag once via inline git in a temporary bare
repository, before any checkout or repository script execution. Annotated tags are peeled
to a commit. The gate exports this SHA; plan/build/publish all check out and verify it.
Dispatch ref never selects application code or helpers, even if its version is identical.
A moved tag cannot change later jobs' source within that run. The workflow definition itself
still comes from GitHub's triggering ref; this does not protect against a maliciously edited
workflow or enforce repository tag immutability across fresh runs.

Evidence:
- `pnpm install --frozen-lockfile`: exit 0, lockfile unchanged (pnpm 9.12.0).
- `node --test apps/desktop/scripts/release-workflow.test.mjs apps/desktop/scripts/ota-version.test.mjs`:
  **41/41 passed** (7 workflow contracts/fixtures + 34 version tests), exit 0.
- `git diff --check`: exit 0.
- Fixtures execute the actual YAML bootstrap shell against temporary local git repositories:
  same-version/different-code dispatch vs tag, lightweight/annotated/unprefixed tags, moved tag,
  missing tag with same-named branch, invalid/ref-like/injected tag, checkout SHA mismatch.
- Static contracts cover all three checkouts/assertions, no repository bootstrap scripts,
  existing dry-run default, universal artifact/presence guard, serial publish, no CI overrides.
- Initial test harness run failed on an incorrect relative workflow path; corrected before
  the passing run. No hosted Actions or live manifest access is claimed.

## P13 — exact SEA Node parity

Implementation and build evidence pending in the separate P13 commit.

## Remaining manual verification

1. After review/integration and separate authorization, rehearse Actions with `dry_run=true`
   and a same-version/different-SHA dispatch ref. Confirm all three checkout logs show the
   requested tag's resolved SHA, including the publisher. This session does not dispatch it.
2. Signed full universal desktop build and `verify-universal.mjs --require cloudflared`;
   launch the packaged app on both Intel and Apple Silicon. Local sidecar evidence, if run,
   will be recorded separately and is not a full universal app build.
3. Real publication remains a separate explicit approval; no release creation, R2 upload,
   Discord announcement, secret changes, OTA command, Worker deployment, push, PR or merge
   is performed by this task. No full sweep.
