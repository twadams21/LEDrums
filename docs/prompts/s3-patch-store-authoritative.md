# S3 — Store adopts the Project; Patch graph wiring authoritative

Part of the **Patch Graph authoritative** mission (`docs/prompts/patch-graph-authoritative.md`). Branch `feat/unified-shell`. **Depends on S1 (the `setKitOutputs` message + voice-host reload) and S2 (`patch-routing.ts` compiler) — read both their briefs + commits first.**

## Why
The active `TriggerLab` store discards the server `Project` (`store.svelte.ts:427 onState: (_project, model)`), so nothing routing/geometry/transport reaches the UI, and the Patch graph's output half is ephemeral `$state.raw` rebuilt from the kit on every mount. Make the store hold the authoritative `Project` and make the Patch output-half derive from `kit.outputs`, with rewiring recompiling and sending it.

## Scope (disjoint file set — yours alone)
- `apps/web/src/lib/trigger-lab/store.svelte.ts`
- `apps/web/src/lib/app/views/PatchGraphView.svelte`
- `apps/web/src/lib/ws/protocol-types.ts` (add the `setKitOutputs` client message mirror; keep in sync with S1's `ws-protocol.ts`)
- `apps/web/src/lib/ws/client.ts` only if a new send helper is needed
- tests beside the store/compiler usage.
- Use the **Svelte MCP / `svelte:svelte-file-editor`** for the `.svelte` file.

## Tasks
1. **Adopt the Project.** Store `project` as `$state` populated from the `state` message (stop discarding `_project`). Keep `serverModel` behaviour intact. Persisting is server-side (the Project round-trips); do **not** add routing to localStorage.
2. **Thin mutators** that optimistic-write locally + send WS: `setDrumTransform(drumId, partial)` → `setKitTransform`; `setRouting(outputs)` → `setKitOutputs`; `setInputMap(map)` → `setInputMap`; `setOutput(partial)` → `setOutput`. (Messages exist after S1; mirror their shapes.)
3. **Patch output-half derives from authoritative outputs.** In `PatchGraphView`, build the `hoop→dataline→output→controller` nodes/edges from `outputsToPatch(store.project.kit.outputs)` (S2) instead of the ephemeral kit-chunk default. Keep the input half (`input→trigger→zone→drum`) as today (derives from drums/pads).
4. **Rewire → recompile → send.** On a wiring edit (connect/disconnect/reconnect in the output half), recompute `PatchRouting` from the current graph, `patchToOutputs(...)`, and `store.setRouting(outputs)`. Wiring is no longer ephemeral for the output half. Respect the locked graph-UX (memory `graph-interaction-prefs`: no node-lift motion; instant hover; drop-on-node-body → input).

## Acceptance
- `pnpm --filter @ledrums/web typecheck` + `test` clean.
- Reload preserves wiring (it comes from the server Project, not view state). A rewire sends `setKitOutputs` and (with S1) reroutes in voice mode.

## Don't
- Don't change the trigger graph. Don't reintroduce a localStorage parallel routing store. Don't merge to main.

## Report back
Report to parent with commit SHA, files, gate output, and the store API you added (S4 builds on it). **Commit on `feat/unified-shell`** first.
