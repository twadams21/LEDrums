# S5 — Patch-graph-authoritative cleanup (a + b + c)

Closes the three follow-ups from S1–S4 (`docs/prompts/patch-graph-authoritative.md`, read it for the model + the S1–S4 commits `ee90ac5`/`66fa91c`/`4034745`/`5139115`/`9f3ac89`/`b52ec84`). Branch `feat/unified-shell`. **You are the only agent running — no disjoint-file constraint; touch whatever each part needs, but keep each part a focused commit.** Use the **Svelte MCP / `svelte:svelte-file-editor`** for any `.svelte` work.

## (a) Show renames on the node face
Today node rename is stored (`store.patchLabels` + `store.setPatchLabel`, added in S4) and shown in the Inspector, but the **graph node still renders the derived label**. Make the patch node component prefer the override: `store.patchLabels[nodeId] ?? describePatchNode(...)` (or the existing derived label). Find the patch node renderer (the `NodeCard`-based patch node component used by `PatchGraphView.svelte`); pass `patchLabels` through reactively so a rename updates the node face live. Add/extend a small test if a pure helper is involved.

## (b) Keep the data-line/output read-out live after a rewire
The Inspector first/last-pixel read-out for data-line / output nodes is exact on (re)entry but can **drift after an in-session rewire without a remount** (it reads a snapshot). Make the read-out a `$derived` of the **current** routing: recompute via S2's `pixelRanges(routing, pixelsForHoop)` (`apps/web/src/lib/app/patch-routing.ts`) from the live `store.project.kit.outputs` / current `PatchRouting` whenever the selection or routing changes. Verify it updates after a drag-reorder / rewire, not just on reselect.

## (c) Plumb the missing standard transport fields through `setOutput`
S4 noted `OutputSettings` already has `port` + `iface` but neither is carried by the `setOutput` WS message/handler, and **sACN `priority`** is genuinely missing. Plumb all three end-to-end:
- **core** `packages/core/src/model/project-schema.ts` — add `priority` to `OutputSettings` (sACN priority, int 1–200, default 100). Confirm `port`/`iface` exist; add if not.
- **io** — ensure the sACN sender (`packages/io/src/sacn.ts`) emits the configured `priority` in the E1.31 framing layer, and Art-Net/sACN honor `port`/`iface` (`packages/io/src/artnet.ts`). Wire through whatever consumes `OutputSettings` (`apps/server/src/output-manager.ts`).
- **server** `apps/server/src/ws-protocol.ts` (+ allow-list) + `input-router.ts` — extend the `setOutput` message + handler with `priority?`, `port?`, `iface?`; ensure both the legacy host and **voiceHost** apply them (mirror S1's routing of edits to the active host).
- **web** `apps/web/src/lib/ws/protocol-types.ts` (mirror), `apps/web/src/lib/trigger-lab/store.svelte.ts` `setOutput`, and the **Controller** editor in `apps/web/src/lib/app/docks/Inspector.svelte` — add controls for `priority` (show only when protocol === 'sacn'), `port`, `iface`.

## Gate discipline
- This spans packages. During work, typecheck the touched package (`pnpm --filter @ledrums/<pkg> typecheck`). After committing, run the **full** `pnpm typecheck && pnpm test` on the clean tree and report the totals.
- Svelte autofixer clean on every `.svelte` you touch.
- Commit each part (a/b/c) as its own commit on `feat/unified-shell`. Do **not** merge to main.

## Acceptance
- `pnpm typecheck` 0 errors (all pkgs); `pnpm test` all green including new tests for (a) label override, (b) live read-out, (c) priority/port/iface plumbing (a server or io test that the configured priority/port reaches the sender).
- Rename shows on the node face; read-out stays correct after a rewire; sACN priority + port + iface round-trip from the Controller editor to the sender.

## Report back
Report to parent (`twux send-message --session parent`) with: commit SHAs per part, files touched, full-sweep totals, any schema field added, and anything you deviated on. **Commit before reporting** (parent verifies from git). Leave `.mex/ROUTER.md` to the orchestrator.
