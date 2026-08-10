# Slice: universal macOS binary — one artifact serves both architectures

Requested by Trent (2026-08-10, this machine): replace the two per-arch desktop builds with ONE
`universal-apple-darwin` build. The payoff: Tim (and every Rosetta user) goes **native
automatically on their next regular OTA update** — the updater can never cross-grade
architectures on its own, but a universal artifact served under both platform keys sidesteps
that entirely. This lands in the next OTA release (v0.2.14, together with the colour-token fix
another agent is building — different files, no overlap).

## The design (locked)

**One build, one artifact, same manifest keys.** `tauri build --target universal-apple-darwin`
on the arm64 runner produces one `.app.tar.gz` + one `.sig`. The publish phase publishes that
SAME artifact under BOTH existing platform keys (`darwin-x86_64` and `darwin-aarch64`) — the
existing serial loop already does this if both targets share one `OTA_BUNDLE_DIR`, and
`latest.json`'s schema does not change, so **no updater-client change and old x86_64 installs
update into the universal build**. The signature is identical under both keys (same file).

## What has to become universal (every Mach-O in the bundle)

1. **The Tauri shell** — `rustup target add x86_64-apple-darwin aarch64-apple-darwin`;
   `tauri build --target universal-apple-darwin` handles the lipo itself.
2. **The server sidecar** (`externalBin` `binaries/ledrums-server`). `build-sidecar.mjs` builds a
   Node SEA binary for the HOST arch today. Extend it: generate the SEA blob once (it is a JS
   snapshot, arch-independent — verify this claim against the script), download BOTH darwin Node
   LTS binaries (the pinned-LTS logic already exists), inject the blob into each with postject,
   `lipo -create` the pair. Tauri resolves `externalBin` per target triple — for a universal
   build it expects `ledrums-server-universal-apple-darwin`; confirm the naming Tauri v2 wants
   and emit it.
3. **cloudflared** (bundled resource). `fetch-cloudflared.mjs` downloads one arch today;
   fetch `darwin-amd64` + `darwin-arm64` and `lipo -create`. Keep the existing SHA256 pinning
   per-arch (`CLOUDFLARED_SHA256` handling — extend, don't weaken; see the README note).

A universal bundle with ONE thin binary inside is a silent x86-only regression for arm users —
add a check (script step or test) that walks the built `.app` and asserts every Mach-O is fat
(`lipo -info` / `lipo -archs` contains both). Fail the build otherwise. This is the slice's
parity guard.

## Workflow reshape (`.github/workflows/release-ota.yml`)

- Build matrix (2 legs) → ONE build job on `macos-26` (arm64). Add the x86_64 Rust target.
  Artifact name e.g. `bundle-universal`.
- Publish job: download once; the existing loop over `needs.plan.outputs.platforms` stays —
  point every iteration's `OTA_BUNDLE_DIR` at the same downloaded bundle. `ci-plan`, platform
  keys, guards, announcement behaviour: all unchanged.
- Keep the serial-publish structure and the header comments truthful (update the phase
  description; the `!! SERIAL PUBLISHING ONLY !!` reasoning in `publish-ota.mjs` still applies —
  two manifest keys are still two read-modify-writes).
- Sourcemap upload leg: keep (one leg exists anyway now).
- Dry-run input, secrets, triggers: unchanged.

## Constraints

- `packages/core` untouched; this is build/packaging + workflow only. Expected files:
  `apps/desktop/scripts/build-sidecar.mjs`, `fetch-cloudflared.mjs`, possibly
  `prepare-bundle.mjs`/`package.json`/`tauri.conf.json`, `.github/workflows/release-ota.yml`,
  `apps/desktop/README.md`. Do NOT touch `apps/web/src/styles/` (another agent owns it).
- The local fallback (`pnpm ota bump` on one machine) keeps working as a HOST-ARCH build — a CI
  outage must not require cross-compilation locally. Document that the fallback publishes only
  the host's platform key.
- This machine is an Intel i9: you can BUILD the universal bundle locally (rustup targets, lipo,
  postject all work) and verify fatness structurally (`lipo -archs`, the parity check), but you
  cannot EXECUTE the arm64 slice. Say so in your report; behavioural proof of the arm slice
  comes from the orchestrator's CI dry run after merge.
- Artifact size roughly doubles for the Mach-O parts. Report the before/after `.app.tar.gz` size
  so the tradeoff is on record.

## Verification (all required)

- Local universal build completes; parity guard passes (every Mach-O fat); x86_64 slice
  smoke-runs on this host (`arch -x86_64` where relevant, or plain execution since host is x86).
- `pnpm typecheck` + `pnpm test` green (desktop node:test included).
- Workflow YAML parses (repo has `yaml` in node_modules) and its env/output plumbing traced
  against `publish-ota.mjs` expectations.
- README "Release flow" updated where it mentions per-arch builds.

## Ops notes

- Worktree `../ledrums-universal`, branch `feat/universal-macos-build`. `pnpm install` first.
- `pnpm test` serialises via the repo test lock — normal.
- The colour agent (`color-tokens-5fd40a`) works in `../ledrums-color-tokens` on web styles —
  disjoint; if you believe you must touch a file it owns, stop and message your parent instead.

## Done

Committed on the branch, sweep green, pushed, **PR opened into main — do not merge it**. Report:
branch, PR number, artifact size delta, the parity-guard mechanism, sidecar/cloudflared approach,
and what could only be structurally (not behaviourally) verified locally.
