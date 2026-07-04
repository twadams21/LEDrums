# Cross-lane seam review — Rock Solid pre-final-gate (Opus reviewer)

You are the pre-final-gate **cross-lane seam reviewer** for the "Rock Solid" initiative. All 49 slices (4 lanes) + Phase-2 "waves 1–4" polish are merged on `rock-solid` (HEAD `ddd5c81`, full sweep green: 2009 tests). Each GROUP was already reviewed at merge. **Your job is NOT to re-review groups** — it is to verify the **integration seams BETWEEN lanes** (and between the lanes and the Phase-2 shell rework) hold together, since bugs there fall through per-group reviews. Read-only + report; do not fix (report findings to parent/master; the master decides fix-vs-accept). Report via `twux send-message --session parent --status ready`.

## Read first
- `docs/handoff/2026-07-02-rock-solid-tracker.md` (state + ESCALATIONS notes, incl. the two deferred live spot-checks and the `$effect` bug-class lesson).
- The group reports `docs/handoff/rock-solid/group-*.md` (context packs describe each seam's invariants).
- `docs/plans/2026-07-03-phase2-review/HANDOFF.md` (Phase-2 items — some overlap the lanes).

## Seams to verify (the whole point)
1. **Routing ↔ looks ↔ modulation authority** (E/S12 authority principle × I modulation × E/S15–16 looks): the server is the sole authoritative fire/render when linked; the sim is offline-preview only. Confirm modulation output + section looks + input routing all respect the ONE authority (no double-fire, no client-side render when linked).
2. **Modifier ↔ modulation wiring** (H modifiers × I modulation): modulation sources drive modifier params; the H residual (modifier per-param envelopes render-apply) was to be closed by I/doc-10. Confirm it IS closed (persisted modifier envelopes actually render-apply) and the modifier↔modulation param plumbing is consistent.
3. **Library ↔ clipboard closure** (J/S40 closure extraction × K/S43 clipdoc): closure extraction feeds serialize/parse/remap; refs/resolve/detach (S41) vs clipboard remap must agree on identity/ownership. Confirm no id-collision or dangling-ref across the J×K boundary.
4. **Desktop ↔ PixLite ↔ OutputStatus** (C desktop × L pixlite × B/S02–S03 output surfaces): the controller panel (S48) extends the S03 OutputStatusPanel; the confidence chain (app→server→controller→output) must be consistent with the OutputStatus/OutputPill truth from Lane 1.
5. **Phase-2 shell/effects rework ↔ lane work** (waves 1–4 × everything): the shell/inspector/node-preview/theme rework landed across the lanes; confirm no seam regressions — esp. the `$effect` self-write bug class (grep `read('--…', c.` etc.; the shared `readThemeTokens` helper should be the only path), node previews, and the flush-shell rails vs the new controller panel.

## Method
- Trace each seam through the actual code (not just reports). Grep the shared files (`store.svelte.ts`, protocol types, compositor/engine, the shared UI primitives). Check the invariants each group report claims at its seam.
- **Do a LIVE smoke-load** (`LEDRUMS_ENGINE=voice pnpm dev`) exercising cross-seam flows (wire a modulation→modifier param on a play node; open the controller panel; copy/paste a song/patch) — clean console, no `effect_update_depth_exceeded`, no rAF throws.
- Run the full sweep once to reconfirm green (`pnpm typecheck && pnpm test`).

## Report (≤30 lines)
Per seam: HOLDS / RISK / BROKEN + one line of evidence. List any concrete defects (file:line, failure scenario) most-severe first. End with a GO / NO-GO recommendation for the rock-solid→main final gate (the two hardware/signed-build spot-checks are Trent's at the gate — don't block on those).
