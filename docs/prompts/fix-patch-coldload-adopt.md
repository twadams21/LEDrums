# Fix — Patch graph must adopt server routing on cold load

Branch `feat/unified-shell`. **Web-only, scoped to ONE file.** A sibling agent (`v-velocity-fold`) is concurrently editing `sim.ts` / `store.svelte.ts` / `Inspector.svelte` / `core/voice` — **do NOT touch any of those.**

## The bug (confirmed)
On a cold page load, the routing the user wired into the Patch graph appears **reset to default**. Root cause: `apps/web/src/lib/app/views/PatchGraphView.svelte:218` builds the output-half **once at mount** from `untrack(() => store.project?.kit.outputs) ?? []`. The WS `state` message that carries the server's real `kit.outputs` arrives **after** the component mounts, so the view shows `defaultRouting(topoDrums)` and **never re-derives** when `store.project` is populated.

This is NOT a persistence problem — the server has the routing (it's in `apps/server/projects/default.local.json`: 4 outputs × 2 data lines) and the store adopts it into `store.project` (`store.svelte.ts:483-487`). The Patch view just fails to react to it landing. Routing is NOT in localStorage; clearing localStorage merely forces the cold-load timing.

## Scope
- `apps/web/src/lib/app/views/PatchGraphView.svelte` (+ a small PURE helper in `apps/web/src/lib/app/patch-graph.ts` ONLY if you extract a signature fn worth unit-testing — patch-graph.ts is not being edited by anyone else).
- Use the **Svelte MCP / `svelte:svelte-file-editor`**; autofixer clean.

## The fix
Make the **output-half** (the `dataline → output → controller` nodes/edges, built via `outputsToPatch` + `buildOutputHalf`) **re-derive from `store.project.kit.outputs` when it changes** — specifically the null/empty → populated cold-load transition, and genuine external updates (e.g. reconnect to a server with different outputs) — **without clobbering an in-progress local rewire or snapping back on the echo of the user's own just-committed edit.**

Approach (adapt as the code suggests): track a signature of the outputs currently drawn / last applied. In a `$effect`, when `store.project?.kit.outputs`'s signature differs from BOTH (a) what's currently drawn and (b) the user's own `liveRouting` (the existing `$derived` that publishes to `ShellStore.patchRouting`), rebuild the output-half `$state.raw` nodes/edges from the project. So: first arrival adopts; the user's own echo is a no-op; a real external change adopts. The existing input-half (derived from `store.drums`) and the `liveRouting → ShellStore.patchRouting` `$effect` stay as-is. Preserve node x/y where it makes sense (don't fight the locked graph UX — memory `graph-interaction-prefs`).

## Acceptance
- Cold reload of `:5173` (server running, routing already wired) shows the **server's saved routing**, not the default chunk.
- A rewire still commits via `setRouting`/`setKitOutputs` and does NOT snap back on its own echo; an in-progress drag isn't clobbered when a state echo arrives.
- `pnpm --filter @ledrums/web typecheck` + `test` green; svelte autofixer clean on the edited file.

## Report back
Report to parent (`twux send-message --session parent`) with the commit SHA, the guard approach, and gate output. **Commit on `feat/unified-shell` before reporting.** Leave `.mex/ROUTER.md` to the orchestrator.
