# Mission — fold the switch `velocity` mode into `value` (deprecate `velocity`)

Spec captured 2026-06-26 with Trent. Hand to the **patch-graph-authoritative orch agent** to slot in
(it currently owns `Inspector.svelte`, which this touches — see Sequencing). This is the *mission*.

## Goal

The switch node's `on:'velocity'` and the newer `on:'value'` (gate + bands) are near-duplicates —
both route on the trigger's normalized intensity. **Remove `velocity`; `value` is canonical.** Migrate
every existing `on:'velocity'` switch to a behaviour-equivalent `on:'value'` switch. `section` and
`beat` are NOT value-based and **stay unchanged**.

## Background — why a naive swap loses behaviour

- **Old `velocity`** (`switchIndexN`, web `sim.ts` + core `engine.ts`): routes `ctx.velocity` (0–1) into
  **N even bands by child COUNT**, children ordered by **visual y**. Child *i* fires for velocity in
  `[i/N, (i+1)/N)`. One output port, implicit even split.
- **New `value`+`bands`**: explicit ascending cutoffs + **one source handle per band** (`band-${i}`);
  an edge routes from a specific band via `GraphEdge.fromPort`. (Already in web + core after the
  `value-core-eval` slice.)

So the fold must (a) set evenly-spaced cutoffs and (b) **re-assign each outgoing edge's `fromPort`** to
the right band — or routing silently changes.

## The migration (per `on:'velocity'` switch node, N = its outgoing-edge count)

1. `on = 'value'`, `valueMode = 'bands'`.
2. `bands = [1/N, 2/N, …, (N−1)/N]` (N−1 ascending cutoffs → N even bands == the old split).
3. Sort the node's outgoing edges by **target y ascending** (same order `childrenOf` used) and set
   `fromPort = 'band-' + index` on each.
4. Edge cases: **N≤1** → `bands = []` (single band `band-0`; assign the one edge if present);
   **N=0** → `bands = []`, nothing to wire. (A 1-child velocity switch always fired that child — a
   single band reproduces that.)

Idempotent: a graph with no `velocity` switch is untouched; re-running changes nothing.

## Where it runs (all touched files)

- **web `apps/web/src/lib/trigger-lab/sim.ts`** — drop `'velocity'` from `SwitchOn`; remove the
  `velocity` branch in `switchIndexN` (keep `section|beat`). Update `makeNode` default `on` from
  `'velocity'` → `'value'` (with the value defaults already present).
- **web fixtures + `treeToGraph`** — any seed switch block currently `on:'velocity'` becomes the
  migrated `value`+`bands` form, and `treeToGraph` must assign `band-${i}` `fromPort`s when it emits a
  value-bands switch's child edges (mirror step 3). `makeBlock('switch', …)` default → `value`
  (its 2 default children → `band-0` / `band-1`, `bands:[0.5]`).
- **web `store.svelte.ts` (hydrate)** — run the migration over hydrated `graphs` in `applyAuthored`
  (idempotent, always-convert) so a returning user's persisted `velocity` switches fold cleanly. (Same
  defensive spirit as `unionEffects`/`unionPresets`.) No persistence-version bump needed if it's
  idempotent; bump only if you prefer a one-shot.
- **web `Inspector.svelte`** — drop `velocity` from the switch `on` selector (leaving `value` /
  `section` / `beat`). A node mid-migration must never show a now-invalid `velocity` option.
- **core `packages/core/src/voice/{types.ts,engine.ts}`** — drop `'velocity'` from `SwitchOn` + the
  `velocity` branch in `switchIndexN`, **structurally identical to web** (show-builder relies on it).
  Core receives already-migrated graphs from the web `Show`, so core needs no migrator — but it must
  still **defensively treat a stray `on:'velocity'`** (old in-flight data) as `value`/its default rather
  than throwing.

## Tests

- web: migrating an N-child velocity switch yields N even bands with edges on `band-0…band-{N-1}` in
  y-order; routing for a sample velocity matches the pre-fold `switchIndexN` result (parity); N=1 and
  N=0 edge cases; idempotency (re-run = no-op); a `section`/`beat` switch is untouched.
- core: `SwitchOn` no longer accepts `'velocity'` (type-level) + a defensive eval test that a stray
  velocity value doesn't throw.
- Full sweep green on the committed clean tree before reporting.

## Locked decisions

- Only `velocity` folds; **`section` + `beat` stay**.
- Migration is **behaviour-preserving** (even bands + re-wired ports), not a lossy mode swap.
- `value` is the canonical intensity-routing mode going forward.

## Sequencing (important)

- **After** the `value-core-eval` slice — DONE (core already evaluates `value`; `e92bf88`). ✓ unblocked.
- **Coordinate with the patch-authoritative S4 work**: this edits `Inspector.svelte` (switch section),
  which S4 also edits (device inspectors). Run it **after** S4's Inspector changes settle, or as a
  serialized step in the same orchestrator — do NOT run it concurrently with an agent editing
  `Inspector.svelte` (shared-tree collision).

## Constraints / discipline

Branch `feat/unified-shell`; `packages/core` stays pure; one task = one agent on disjoint files;
Svelte MCP / `svelte:svelte-file-editor` for `.svelte`; gate the touched package during work, full
`pnpm typecheck && pnpm test` only on a committed clean tree; commit the coherent change; run GROW
(ROUTER note that `velocity` folded into `value`, bump `last_updated`).
