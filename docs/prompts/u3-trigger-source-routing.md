# U3 — Input routing: resolve a graph from its trigger source

Slice T3 of `docs/prompts/trigger-node-source.md`. Builds on **U1** (`TriggerSource` model + `normalizeTriggerValue` seam, web-only) and **U2** (Inspector). Branch `feat/unified-shell`. **No other agent is running on these files now.** S7 already committed `input-router.ts` (persistence hooks) — build on it.

## Goal
Make incoming inputs actually fire graphs by their declared **trigger source**, end-to-end:
- A physical hit (MIDI/OSC server-side, or a browser `key`) resolves to the matching graph(s).
- **`drum`-source** (pad-bound) graphs keep firing exactly as today (zone-map → padKey).
- **`midi`/`osc`-source** (authored) graphs fire from a **raw** MIDI note/CC or OSC address that is NOT a zone mapping.
- The source's normalized **0–1 value** drives eval (`ctx.velocity`), so the switch `value` mode routes identically for all three sources.

## ⚠️ Precedence + no-double-fire (PINNED — implement exactly this)
For one incoming event:
1. **Zone-map first.** If the MIDI note / OSC address resolves via the patch `inputMap` (`midiNotes`/`oscMap`, keyed `(drumId, slot)`) to a `(drumId, zone)` → fire that **pad-bound** graph (the existing padKey path). **Stop here.**
2. **Direct trigger-source binding only if step 1 did NOT match.** Find authored graph(s) whose trigger `source` matches the raw event (`midi` note/cc, or `osc` address) and fire them.
- **No double-fire:** a single event fires *either* the zone-mapped pad graph *or* direct-bound authored graphs — never both. Zone-map wins ties.

## Scope (disjoint — yours)
- `apps/web/src/lib/trigger-lab/sim.ts` — offline resolution + value-from-source (reuse U1's `normalizeTriggerValue`).
- `packages/core/src/voice/{engine.ts,types.ts}` — **mirror `normalizeTriggerValue` into core** (U1 left it web-only) and resolve a graph from its trigger source on `applyInput`. Keep pure + deterministic.
- `apps/server/src/input-router.ts` — map incoming `midi`/`osc`/`key` events to the resolution above (zone-map precedence, then direct bindings) and dispatch to the voice host.
- tests (web + core + a server/router test).
- **Do NOT** touch: `Inspector.svelte`/`TriggerNode.svelte` (U2), `store.svelte.ts` mutators beyond what resolution needs (prefer not to — coordinate if unavoidable), patch-*/Sections/setlist, `main.ts` persistence.

## Notes / watch-items
- The engine already receives authored graphs (with their `source`) via the `Show` (U1 mirrored `source` into core types; `buildShow` passes it through) — resolution reads from there.
- **Zone convention caveat (pre-existing):** real MIDI maps note → `(drum, slot)` then slot→zone-label, while pad graphs are keyed by numeric `pad.zone` — the long-standing mismatch (known limit (c) in the redesign plan). Do NOT try to fix the whole convention here; keep the **existing** zone-map→pad path working as-is and add the NEW direct `midi`/`osc`→authored-graph path beside it. Flag if the existing path needs a small touch.
- Browser `key` events stay self-consistent (drum source). The new value comes from `normalizeTriggerValue`.

## Tests
- Zone-mapped note fires the pad graph (unchanged); a raw note bound to an authored graph's `midi` source fires THAT graph; an event matching a zone does NOT also fire a same-note direct binding (no double-fire); OSC address binding; value normalization (drum vel / midi vel|cc÷127 / osc arg → 0–1) feeds eval identically; back-compat (existing pad graphs unaffected); core determinism preserved.

## Gate discipline
- During work: per-package typecheck (`web`/`core`/`server`); the core change ripples — keep them green per-package. Full `pnpm typecheck && pnpm test` only on your committed clean tree.
- Svelte MCP not needed (no `.svelte` here).

## Acceptance
- Authored graph bound to a raw MIDI note / OSC address fires from that input through the engine; pad graphs unchanged; no double-fire; full sweep green.

## Report back
Report to parent (`twux send-message --session parent`) with per-area commit SHA(s), files, the resolution/precedence as implemented, gate totals, deviations. **Commit before reporting.** Leave `.mex/ROUTER.md` to the orchestrator.
