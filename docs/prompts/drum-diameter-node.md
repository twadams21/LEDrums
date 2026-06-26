# Drum diameter (inches) control on the drum node (patch graph)

Tiny cross-package feature. You are in a **git worktree** on your own branch — read `docs/prompts/_worktree-note.md` first. Branch base `feat/unified-shell`.

## Goal
Add a **Diameter (in)** editor to the **Drum** node in the Patch graph Inspector, plumbed live through `setKitTransform`. **This is the exact same pattern that commit `4d2f3b6` ("hoop-spacing control on the Drum node") just landed for `hoopSpacingMm`** — mirror it for `diameterIn`. The field already exists in the kit schema (`drumSchema.diameterIn`, a positive number = drum diameter in inches); this exposes + wires it. Changing it rebuilds geometry (ring radius) via `reloadKit()`.

## Plumbing (mirror `4d2f3b6` / the `hoopSpacingMm` path — `diameterIn` sits right beside it now)
- **core** `packages/core/src/engine/engine.ts` — add `'diameterIn'` to `setKitTransform`'s `Partial<Pick<DrumConfig, …>>`.
- **server** `apps/server/src/voice-engine-host.ts` — add `'diameterIn'` to the `Pick`. `apps/server/src/input-router.ts` — pass `diameterIn: msg.diameterIn` in the `setKitTransform` case.
- **protocol** `apps/server/src/ws-protocol.ts` + `apps/web/src/lib/ws/protocol-types.ts` — `setKitTransform` message gains `diameterIn?: number`.
- **web** `apps/web/src/lib/trigger-lab/store.svelte.ts` — `setDrumTransform`'s partial type gains `diameterIn?`.
- **web UI** `apps/web/src/lib/app/docks/Inspector.svelte` — the Drum node editor gains a **Diameter (in)** numeric `Field` beside the Hoop Spacing one, writing `store.setDrumTransform(drumId, { diameterIn })`. **Svelte MCP** for the `.svelte` edit; autofixer clean.

## Acceptance
- Drum node Inspector shows a Diameter (in) field; editing sends `setKitTransform { diameterIn }`, the host `reloadKit()`s, geometry reflects the new ring radius.
- `pnpm typecheck` 0 (all pkgs); `pnpm test` green. Add a small core test (`setKitTransform({ diameterIn })` changes the rebuilt model's ring radius / pixel world positions) mirroring the hoop-spacing test.

## Scope discipline
- Stay in the files above (single-line additions beside the existing `hoopSpacingMm` ones). A sibling agent (U3) is concurrently editing `engine.ts`/`input-router.ts`/`store.svelte.ts` in a separate worktree — keep your additions localized so the orchestrator's merge is trivial.

## Report back
Report to parent with commit SHA + files + gate output. Commit on your worktree branch (do NOT switch branches). Leave `.mex/ROUTER.md` to the orchestrator.
