# Reslice: R15 carried nits — redo against today's main (salvage from #117)

Branch: create `fix/r15-nits-2` from **origin/main**. Work in your worktree; push when green.

## Why a redo

These four small fixes landed only on the never-merged `gen3r/final-wave` branch (PR #117,
being closed). Re-apply them against today's main. Reference commits on
`origin/gen3r/final-wave` (technique reference, not a merge source): `b31b7e3` (LintCallout
reachability row) and the R15 fix commits around `01403f1`. Where main has diverged,
CURRENT MAIN WINS — verify each nit still exists before fixing it; if one is already
fixed/moot on main, skip it and say so in the commit body.

## Scope — verify-then-fix, four items

1. **Dead Block-tree evaluator** in the web sim — if still present on main, delete it.
2. **Zero-displacement `moveNode` undo** — a move of 0px must not push an undo entry.
3. **Collision-safe node/edge id mints** — check whether main's minting can collide after
   hydrate (note: `reserve-library-ids.ts` exists now; this may be fixed — verify).
4. **Reachability inspector row via `LintCallout`** — port `LintCallout.svelte` (from the
   reference branch) into `lib/ui/` and use it for the reachability callout, matching the
   R06 empty-scope pattern. UI touch ⇒ apply `/make-interfaces-feel-better`, extend the
   design system per AGENTS.md (styleguide entry + `pnpm design-system` regenerate in the
   same change), and verify with `pnpm ui-shot`.

## Test discipline (this Mac wedges on parallel sweeps)

Root `pnpm test` routes through `scripts/test-lock.sh` — use it. Ad-hoc: set BOTH
`VITEST_MIN_*=1` and `VITEST_MAX_*=2` pairs (max-only throws on vitest 2.1.9). One sweep
at a time.

Gates: `pnpm typecheck` + `pnpm test` green at committed HEAD, then twux push.
Report to parent: final commit, which nits were applied vs already-moot, test totals.
