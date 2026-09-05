# P12 + P13 — release reproducibility

Source: Trent's implementation request for P12/P13 in
`docs/plans/2026-09-05-codebase-health-audit.md`. Branch: `fix/health-release-repro`,
base `ea18f61` (merged audit PR #202). Implementation is authorized; publication and
infrastructure deployment are not.

## P12 — immutable release source

Commit: `fa28249b0a12735149bf18a2ea9ee73924fe7704`.

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

`apps/desktop/.node-version` is the single version source (**22.23.1**): all release
setup-node steps, desktop CI, the blob generator and both injection targets consume it.
`sea-node.mjs` owns the exact-version policy. Universal/CI launchers reject any mismatch
(including same-major patch differences) before staging/building; `build-universal.mjs`,
`prepare-bundle.mjs`, and the direct sidecar CLI all enforce it. Strict builds also reject
`PREPARE_SKIP_SIDECAR=1`. A conflicting `LEDRUMS_SEA_NODE_VERSION` now directs the operator
to change the reviewed pin instead of introducing a second version source.

Local host-only behavior is deliberately preserved across the existing macOS/Linux/Windows
paths: a mismatched development Node downloads and probes the exact pin. If unavailable,
an even-major ≥20 active Node may be the **same executable for generator AND runtime**, with
a NON-REPRODUCIBLE warning. That offline exception never applies to universal/CI. A downloaded
host runtime reporting a different version fails rather than falling back.

The universal host slice uses the probed generator executable itself; the foreign slice comes
from the checksum-verified official distribution at the same pin. Cached foreign executables
require a matching version/platform/arch receipt and SHA256, not merely a directory name.
Snapshot/code-cache remain off; both architecture aliases remain byte-identical copies of the
fat output. Cache receipts protect against accidental corruption, not a malicious cache owner.
Smoke probes force telemetry and public tunneling off.

### Actual local evidence

Machine: Trent's Intel Mac (`uname -m`: `x86_64`). Development Node **25.8.2**;
SEA generator/runtime Node **22.23.1**. No full workspace test/typecheck/build sweep.

| Check | Observed result |
| --- | --- |
| Frozen install | `pnpm install --frozen-lockfile`, exit 0; no manifest/lockfile changes |
| Targeted tests under development Node | **68/68 passed**: 7 workflow + 34 version + 14 SEA policy/smoke + 13 Mach-O |
| Same targeted tests under pinned Node | **68/68 passed**, exit 0; includes actual CLI mismatch subprocesses for sidecar/universal wrapper/prepare hook, with no artifact directories created |
| Host-only sidecar from Node 25 | `node apps/desktop/scripts/build-sidecar.mjs`, exit 0; fetched verified darwin-x64 Node 22.23.1, generated and injected with it, reached server listening banner |
| Universal **sidecar only**, cold foreign cache | Pinned Node running `build-sidecar.mjs --universal`, exit 0; fetched verified darwin-arm64 22.23.1, injected both slices, lipo reported `x86_64 arm64`, Intel slice reached listening banner |
| Universal **sidecar only**, warm cache/final source | Repeated pinned build, exit 0; log confirmed verified darwin-arm64 cache reuse; both slices present and Intel listening-banner smoke passed again |
| Mach-O CLI guard | `verify-universal.mjs apps/desktop/src-tauri/binaries --require ledrums-server-universal-apple-darwin`, exit 0; **3/3 emitted names** carry both arches. This inspected the sidecar directory, **not a Tauri `.app`** |
| Ad-hoc signature | `codesign --verify --strict apps/desktop/src-tauri/binaries/ledrums-server-universal-apple-darwin`, exit 0; no production signing key used |
| Workflow syntax | Both modified workflows parsed with Ruby YAML; not a hosted Actions execution |
| Whitespace | `git diff --check`, exit 0 |

Targeted command, run with both Nodes:

```bash
node --test apps/desktop/scripts/sea-node.test.mjs \
  apps/desktop/scripts/release-workflow.test.mjs \
  apps/desktop/scripts/mach-o.test.mjs \
  apps/desktop/scripts/ota-version.test.mjs
```

Pinned build command (Intel host; version comes from the file):

```bash
PIN=$(tr -d '\\n' < apps/desktop/.node-version)
PIN_NODE="apps/desktop/.node-pin/node-v${PIN}-darwin-x64/bin/node"
"$PIN_NODE" apps/desktop/scripts/build-sidecar.mjs --universal
```

Final sidecar SHA256 (all three emitted names):
`c9b3d95cd27300eed6ca0213cf673664f82a31075c11b47737cc7dcc2c053c6a`.
This proves alias equality for the observed output, not cross-machine byte-for-byte signed-app
reproducibility. Downloads/intermediates/binaries stay in existing gitignored build directories.

### Scope/conventions check

1. Pure-core/IO boundary: unchanged; no core or runtime feature code touched.
2. Model/schema types: unchanged; new code is desktop build-tool JavaScript, no duplicated domain types.
3. Deterministic effects/rendering: unchanged.
4. WS unions/handlers: unchanged.
5. Verification: colocated targeted tests and real sidecar build/smokes above; full `pnpm test`,
   `pnpm typecheck`, Rust build and UI verification intentionally not run for this release-only slice.

Maintenance record/runbook is in this report and the desktop README's release-source identity
and exact SEA pin policy sections; global ROUTER files are untouched.

## Remaining manual verification

1. After review/integration and separate authorization, rehearse Actions with `dry_run=true`
   and a same-version/different-SHA dispatch ref. Confirm all three checkout logs show the
   requested tag's resolved SHA, including the publisher. This session does not dispatch it.
2. Signed full universal desktop build and `verify-universal.mjs --require cloudflared`;
   launch the packaged app on both Intel and Apple Silicon. **No full universal Tauri app,
   cloudflared fetch/build, updater archive, production signature or Apple Silicon launch was
   performed.** The successful universal sidecar build above does not stand in for these checks.
3. Native Linux/Windows host-only build/smoke and real offline even-major fallback startup.
   Their selection policy is tested locally, but those native execution paths were not run here.
4. Real publication remains a separate explicit approval; no release creation, R2 upload,
   Discord announcement, secret changes, OTA command, Worker deployment, push, PR or merge
   is performed by this task. No full sweep.
