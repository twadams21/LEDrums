# P15 — trustworthy dead-code checks

Source: approved follow-ups in `docs/plans/2026-09-05-codebase-health-audit.md`. Implementation default: preserve explicitly held Patch/prototype files until the previously required parity/hardware sign-off; unreachability alone is not removal evidence. The user's unrelated prototype checkout is untouched.

## Changes

- Pin **Knip 5.50.0**, the verified pure-JS scanner version. The initially tried 5.88.1 introduced native OXC resolver bindings; that dependency change was replaced, not shipped. The final added dependency graph uses `enhanced-resolve`, without new native addons or node-gyp.
- Put entrypoints in their owning workspaces: web main/design-system/dev screenshot seam and contrast tool; desktop shell; manual root probes. Explicitly register both Vite configurations. The former root-only list did not protect entries in child workspaces.
- Keep eight explicitly named held Patch files in `knip.json`'s `ignore` list. These are a documented hold, not a claim they are runtime-reachable. Do not expand this list to silence new findings without independent evidence.
- Remove the unused **root** Vitest dev dependency. Every testing workspace retains its own declared Vitest dependency; the root test command delegates to them. No runtime dependency was removed here.
- Add `pnpm dead-code` for unreachable files/dependencies/resolution issues, and `pnpm dead-code:exports` as a separate advisory inventory. Unconsumed exports can be intentional public/testing seams: they are not auto-deleted or falsely represented as a clean baseline.
- Add `pnpm dead-code:verify` to CI and `gates:run`. It creates one UUID-named unreachable TypeScript fixture, runs the actual scanner, requires precisely that file and no dependency findings, removes only its own fixture in `finally`, and checks the clean tree again. Thus a configuration that simply marks everything reachable does not pass.
- Use explicit `pnpm ... run prepare:bundle` in CI so the older pure-JS scanner correctly recognizes a workspace script, rather than treating its name as an external binary.
- `scripts/health-startup.mjs` supplies a repeatable cold-production browser probe for the bundle follow-up. It requires a loopback URL and observes disabled output before firing a UI pad. Its timings are synthetic browser evidence, not physical lighting latency.

## Verification

`pnpm dead-code:verify` passes with the pinned scanner: live web/shell/API entries are retained, the seeded dead file is detected, and the scoped baseline has zero findings. The first pure-JS run deliberately exposed missing explicit HTML entry/config registration; a later run exposed ambiguous CI script syntax. Both were corrected rather than suppressed.

The original latest-version scan found 11 file candidates: eight held Patch files and three live/manual entries. The desktop `@tauri-apps/api` false positive also disappears after workspace ownership is corrected. Therefore no source-file deletion was justified by this scan; the root-only unused test-runner declaration was the safe dependency cleanup.

Full integrated install/typecheck/test/build, desktop preparation, design-system regeneration and browser entrypoint verification are integration gates, not results implied by the scanner. No release, Worker deployment, live controller operation or automated source deletion occurred.
