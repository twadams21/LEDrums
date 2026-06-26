# Hoop-spacing control on the drum node (patch graph)

Small cross-package feature. You are in a **git worktree** on your own branch — read `docs/prompts/_worktree-note.md` first. Branch base: `feat/unified-shell`.

## Goal
Add a **hoop spacing** (`hoopSpacingMm`) editor to the **Drum** node in the Patch graph Inspector, plumbed live through `setKitTransform` so changing it rebuilds geometry (the vertical gap between a drum's hoops). The field already exists in the kit schema (`drumSchema.hoopSpacingMm`) — this exposes + wires it, exactly like the other drum-transform fields (`startAngleDeg`, `pixelsPerHoop`, etc.) added earlier.

## Plumbing (mirror the existing `setKitTransform` path for `pixelsPerHoop`)
`setKitTransform` already carries `origin/rotation/localSpinDeg/startAngleDeg/pixelsPerHoop`. Add `hoopSpacingMm` alongside, end-to-end:
- **core** `packages/core/src/engine/engine.ts` — `setKitTransform`'s `Partial<Pick<DrumConfig, …>>` gains `'hoopSpacingMm'` (then `rebuild()` as now).
- **server** `apps/server/src/voice-engine-host.ts` — `setKitTransform`'s `Partial<Pick<…>>` gains `'hoopSpacingMm'` (then `reloadKit()`). `apps/server/src/input-router.ts` — the `setKitTransform` case passes `hoopSpacingMm: msg.hoopSpacingMm` through.
- **protocol** `apps/server/src/ws-protocol.ts` + `apps/web/src/lib/ws/protocol-types.ts` — the `setKitTransform` message type gains `hoopSpacingMm?: number`.
- **web** `apps/web/src/lib/trigger-lab/store.svelte.ts` — `setDrumTransform`'s partial type gains `hoopSpacingMm?` (it already forwards a partial to `setKitTransform`; just widen the type / pass it).
- **web UI** `apps/web/src/lib/app/docks/Inspector.svelte` — the **Drum** node editor gains a `hoopSpacingMm` numeric `Field` (mm), writing via `store.setDrumTransform(drumId, { hoopSpacingMm })`. Place it beside the existing spacing/geometry controls; reuse the same `Field`/`CommitInput` pattern. Use the **Svelte MCP** for the `.svelte` edit; autofixer clean.

## Acceptance
- The Drum node Inspector shows a Hoop Spacing (mm) field; editing it sends `setKitTransform { hoopSpacingMm }`, the voice host `reloadKit()`s, and geometry reflects the new gap.
- `pnpm typecheck` 0 (all pkgs); `pnpm test` green (add a small test if the server router gains a branch — otherwise the type plumbing is covered by typecheck). Add a core/host test that `setKitTransform({ hoopSpacingMm })` changes the rebuilt model's hoop positions if cheap.

## Scope discipline
- Stay in the files above. A sibling agent (U3) is concurrently editing `input-router.ts`, `engine.ts`, and `store.svelte.ts` in a SEPARATE worktree — you won't see its edits; just make your minimal `hoopSpacingMm` additions and the orchestrator merges. Keep your edits to those files **localized** (add the one field/case) so the merge is trivial.

## Report back
Report to parent with commit SHA(s) + files + gate output. Commit on your worktree branch (do NOT switch branches). Leave `.mex/ROUTER.md` to the orchestrator.
