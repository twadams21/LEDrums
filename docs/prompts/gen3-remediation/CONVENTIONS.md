# Gen3 remediation — implementer conventions

You are one of several parallel implementer agents working the Gen3 UX
remediation tickets (GH issues #80–#108). Your ticket brief names your issue.
This file is the shared logistics contract.

## Source of truth
- Your GitHub issue body is the spec of record: `gh issue view <N> -R twadams21/LEDrums`.
- Parent spec: `docs/plans/2026-07-09-gen3-ux-remediation-spec.md` (read your ticket's phase section).
- Project rules: `AGENTS.md` (non-negotiables: pure core, design system, ui-shot verification, /make-interfaces-feel-better for UI work).

## Working environment
- You are in a dedicated git worktree on your own branch (`git branch --show-current` confirms). Sibling agents work in other worktrees — never touch their branches or the shared `codex/gen3-graph-authoring` branch; the orchestrator merges.
- If you start a dev server (for `pnpm ui-shot`), pick non-default ports so siblings don't clash, and stop it when done.
- Stay strictly in your ticket's scope. If you discover an adjacent bug, note it in your report; don't fix it.

## Gates (run before reporting done)
- **Full gates go through the machine-wide lock: `pnpm gates`** (= typecheck +
  full test suite, serialized across all worktrees via
  `scripts/with-gate-lock.mjs`). NEVER run a bare full `pnpm test`/`pnpm
  typecheck` as your final verification — parallel full suites exhaust the
  machine and flake each other. If the lock is held you'll see who holds it;
  just wait, it polls.
- During development, run SCOPED tests only (`pnpm --filter <pkg> exec vitest
  run <file>`), with workers capped: `VITEST_MAX_FORKS=2 VITEST_MAX_THREADS=2
  VITEST_MIN_FORKS=1 VITEST_MIN_THREADS=1` (MINs required — Tinypool rejects
  min>max on many-core machines).
- UI-touching tickets: `pnpm ui-shot` capture(s) of the affected surface, and regenerate `docs/design-system.html` (`pnpm design-system`) if you added/changed styleguide-covered UI.

## ui-shot: reach states ad-hoc, don't register presets
Per `scripts/ui-shot/README.md`: if a shot needs app state that `--state`
can't reach, extend `window.__LEDRUMS_SHOT__` with ONE adapter method in
`shot-seam.ts` (never a bespoke click script). Then capture **ad-hoc**:
`pnpm ui-shot --state "..." --target "..." --name <shot> --strict`.
**Do NOT add entries to `scripts/ui-shot/shots.json`** — presets are locked
CI/sweep baselines only, and promoting a shot is the orchestrator's call.

## Deliverables
1. Incremental commits on your branch (small, well-messaged).
2. A committed report at `docs/reports/2026-07-09-gen3-r<NN>.md`: what changed,
   root causes found, files touched, test counts, gate results, deviations,
   follow-ups. Keep it slim — it becomes the Notion implementation report.
3. Final message to the orchestrator:
   `twux send-message --session parent --status "done|blocked" --body "R<NN> #<issue>: <one-line outcome>. Branch <branch>, HEAD <sha>. Report docs/reports/....md"`

Do NOT close the GitHub issue or touch Notion — the orchestrator does both after merge.
