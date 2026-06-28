# Slice S2 — Takeover, roles & read-only UI

_PRD: `docs/plans/2026-06-28-multiplayer-tauri-prd.md` · ready-for-agent · Blocked by: S1_

Use the `/implement` skill. You are in a git worktree — read `docs/prompts/_worktree-note.md` first. **Do NOT touch `packages/core`.** Build on S1's `ClientRegistry` + presence/`showLibrary` protocol.

## What to build
Let any client claim the editor role with a **Takeover** button, drop the prior editor to viewer, and make every viewer's UI genuinely **read-only** (affordances disabled, not just ignored), with a clear "who's editing" indicator. Server-side, gate **all** authoring mutations to the editor while leaving engine inputs ungated.

End-to-end: a viewer clicks **Takeover** → becomes editor; the prior editor's UI flips to read-only; all clients' indicators update. A viewer's edit attempts do nothing and look disabled. The drummer can still hit drums (inputs) regardless of who's editing.

## Scope (current pointers — verify)
- **`packages/protocol/src/index.ts`** — add `ClientMessage` `{ t: 'takeover' }`.
- **`apps/server/src/main.ts`** — handle `takeover` → `registry.takeover(socket)` → broadcast `presence`. Gate **all** authoring/mutation messages via `registry.canMutate(socket)`: `setShow`, `setShowLibrary`, `setKitTransform`, `setKitOutputs`, `setOutput`, `setInputMap`, and the setlist/song/section mutations (`setActiveSection`/`addSong`/`removeSong`/`addSection`/`removeSection`/`setBinding`/`removeBinding`/`setSectionLayerClip`/layer+clip mutations). **Do NOT gate engine inputs** — `midi`/`osc`/`cc`/`programChange`/`key`/`recallSection` always drive the engine (they come from the drummer's local hardware). A rejected mutation is a no-op (optionally an `error`/notice).
- **`apps/web/src/lib/app/chrome/TopBar.svelte`** — a **Takeover** button + an editing/viewing indicator ("You're editing" / "<editor> is editing — Viewing"). Pressing it sends `{ t:'takeover' }`.
- **`apps/web/src/lib/trigger-lab/store.svelte.ts`** (+ the views that expose editing affordances) — when `role === 'viewer'`, gate the authoring mutators (no-op) and disable the edit affordances at their call sites. View-only interactions (selecting a graph to view, panning the canvas, switching views) stay enabled; the visualisers + live state stay fully live. Finalise the role-aware reconcile from S1.

## Acceptance criteria
- [ ] Any client can press Takeover → becomes editor; the prior editor drops to viewer; `presence` reflects on all clients.
- [ ] Near-simultaneous takeovers resolve last-press-wins; all UIs converge on the same editor.
- [ ] Viewer UI: every edit affordance is visibly disabled + a clear "X is editing / Viewing" indicator; the editor sees "You're editing".
- [ ] Server rejects authoring mutations from non-editors (no-op) and accepts engine inputs from anyone.
- [ ] Role-aware reconcile holds: editor/standalone local-wins; viewer always follows.
- [ ] Switching role (editor↔viewer) live-updates the UI gating without a refresh.

## Tests to write
- **Server handler integration** (multi-socket capturing harness, same style as the S1/server tests): `takeover` flips roles + emits `presence` to all; a non-editor's `setShowLibrary`/`setShow` is rejected; engine inputs are accepted regardless of role.
- **Extend `apps/web/src/lib/trigger-lab/store.server-library.test.ts`**: takeover transitions update `role`; a viewer's authoring mutators no-op; the indicator-driving state is correct per role.

## Verify
`pnpm typecheck` (0) and `pnpm test` (green; add the new tests). Report commit SHA(s) + files.
