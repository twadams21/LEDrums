# Brief — wire `on:'value'` switch routing into `packages/core` (the server engine)

You are a **twux implementer agent** on LEDrums (branch `feat/unified-shell`). Read this brief, then
`.mex/ROUTER.md` (project state + GROW) and `CLAUDE.md` (non-negotiables) before coding. Report to
your parent when done (command at the bottom).

## Why

The Trigger graph's **value-routing switch** (`on:'value'`, gate + bands) was implemented + tested in
the **web** sim (`apps/web/src/lib/trigger-lab/sim.ts`) but NOT in `packages/core`, which is the
engine that evaluates graphs **server-side**. So today a connected server treats a `value` switch as
its default child — value routing only works in the local/offline sim. Mirror the web eval into core
so it routes through the real engine (and on real output).

The web sim was the source the core `voice` types were ported from — they are **structurally
identical by design**, so this is a faithful mirror, not a redesign.

## Reference (read first — this is the spec)

- `apps/web/src/lib/trigger-lab/sim.ts` — the authoritative implementation. Study:
  - `type SwitchOn` (now includes `'value'`), the `GraphNode` value-switch fields
    (`valueMode: 'gate'|'bands'`, `threshold`, `invert`, `bands: number[]`), and `GraphEdge.fromPort?`.
  - `evalNode` switch case for `on:'value'`: **gate** (`pass = invert ? value > threshold : value <=
    threshold`, value = `ctx.velocity`; pass → eval default children, else `[]`) and **bands**
    (resolve band index from ascending `bands` cutoffs → eval children wired from that band's handle).
  - the band resolver + the `childrenViaPort` helper (children whose edge `fromPort === `band-${i}``,
    y-sorted), vs `childrenOf` (default output).
- `apps/web/src/lib/trigger-lab/*.test.ts` — the value-switch unit tests (gate pass/block/invert; band
  boundary picks incl. value at a cutoff and above the last cutoff; empty band). **Mirror these** as
  core tests.
- Inspect the exact web logic via `git show 0042364` (the model+eval commit) if helpful.

## Targets (core mirror)

1. `packages/core/src/voice/types.ts` —
   - `SwitchOn` += `'value'`.
   - `GraphNode` += `valueMode`, `threshold`, `invert`, `bands` (same shapes/defaults as web).
   - `GraphEdge` += `fromPort?: string`.
   - **Keep structurally identical to the web `sim.ts` types** (show-builder relies on structural
     assignment — see step 4).
2. `packages/core/src/voice/engine.ts` —
   - Add the `value` gate/bands branch to the `switch` case in `evalNode` (~line 361), mirroring
     `sim.ts`. Add a `childrenViaPort(graph, node, port)` helper alongside `childrenOf` (~300) and a
     band-index resolver. `velocity | section | beat` via the existing `switchIndexN` stay unchanged.
   - **Defensively default** missing value-fields (legacy shows never carry `on:'value'`, but tolerate
     absence — default `valueMode:'gate'`, etc.) so a malformed/old graph can't throw in the engine.
3. `packages/core/src/voice/engine.test.ts` — add the mirrored gate + bands tests. Keep determinism.
4. `apps/web/src/lib/trigger-lab/show-builder.ts` — once core's types carry `on:'value'` + `fromPort`,
   the documented bridge cast `{ ...source.graphs } as voice.Show['graphs']` (~line 54) is **no longer
   needed** — the web↔core types re-converge. **Remove the cast** (back to plain `{ ...source.graphs }`)
   and trim the now-stale comment. (If full typecheck still needs it, KEEP it and say why in your
   report — don't force-cast around a real divergence.)

## Constraints / discipline

- **`packages/core` stays PURE** — no Node/DOM/IO imports (it already is; keep it that way). The eval
  must stay a deterministic pure function of `(graph, ctx)` — no hidden global state, no `Math.random`
  beyond what the existing engine already seeds via its PRNG (match how `random` is handled in
  `evalNode`; value/gate/bands are deterministic from `ctx.velocity`, so no RNG needed).
- During work gate the touched packages: `pnpm --filter @ledrums/core typecheck && pnpm --filter
  @ledrums/core test`; and `pnpm --filter @ledrums/web typecheck` after the show-builder change. Run
  the FULL `pnpm typecheck && pnpm test` only once, on the committed clean tree, before reporting.
- One coherent change — commit it (suggest: `feat(core): evaluate on:'value' switch (gate + bands) +
  drop web bridge cast`). The orchestrator verifies via git, so commit before reporting.
- Run **GROW** after: note in `.mex/ROUTER.md` that value switches now route through the core engine
  (close the gap recorded in the switch-value entry); bump `last_updated`.

## Report back (verbatim)

```
twux send-message --session parent --status "<one-line status>" \
  --body "<commit; full gate results (typecheck + per-package test counts); whether the show-builder cast was removed (or why kept); any web↔core divergences found; parity notes vs the web sim eval>"
```

Report honestly — if core and web eval differ in any way you couldn't reconcile, say so. Commit before
reporting; don't leave work uncommitted.
