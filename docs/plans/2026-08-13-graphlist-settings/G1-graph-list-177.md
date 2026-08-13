# G1 — Trigger graph list: thumbnails, fire indicators, Add-graph modal, sync badge, context menu

**Source:** GitHub issue #177 (read it first: `gh issue view 177`) — filed by Trent from playing
the kit 2026-08-13. **Base:** branch off `origin/feat/tabbed-chrome` (PR #176's head — this work
stacks on the tabbed chrome). PR targets `feat/tabbed-chrome`, NOT main. Open with:

```
git fetch origin && git checkout -b feat/graph-list-177 origin/feat/tabbed-chrome
git log --oneline -3   # confirm tip is ce164fd or a descendant; if feat/tabbed-chrome
                       # has moved, use its current tip; if the branch is GONE (merged
                       # + deleted), STOP and report before basing on main
```

## Goal

Five improvements to the Trigger view's graph list
(`apps/web/src/lib/app/views/TriggerGraphsRail.svelte`). The **what** is fixed by issue #177;
the **how it looks** (spacing, badge placement, modal layout) is yours — follow the design
system and the polish skill, and match the app's existing visual language.

### 1. Thumbnails
- Zoom out: space between card edge and the outermost points. `graph-thumb.ts` `graphThumb()`
  already takes a `pad` param (currently 16 on a 172×104 viewBox) — tune it, don't fork it.
- Dots take the colour of the node kind they represent. The authoritative kind→tint map is
  `tint` in `apps/web/src/lib/app/views/trigger-node-meta.ts:63-84` — reuse it; do NOT mint
  new colours. `graphThumb()` must return the node kind (or resolved tint token) per dot;
  extend its return type and its unit tests in lockstep.

### 2. Fire indicators — the tracing problem (the novel seam; read this twice)
- A graph card shows a fire indicator **when the engine renders that graph** — the diagnostic
  for "which graph did that hit trigger" and for graphs firing **from other songs**.
- What exists: `store.lastSectionFire` `{key, seq}` + the `.fireburst` overlay in
  `TriggerGraphsRail.svelte:39-48` — but it is only set by `fireSectionGraph()`
  (`store.svelte.ts:1840`), i.e. keyboard fires. `markGraphFire(key)` / `graphFireAt[key]`
  (`store.svelte.ts:975`) exist too. **Verify what actually happens on a real drum hit**, in
  both modes: offline (local sim resolve path, `resolveHitGraphsLocal`) and connected (server
  voice engine resolves the hit — does ANY message tell the client which graph keys fired?).
- If no signal reaches the client in connected mode, build the minimal one: engine/host-side
  "graphs fired for this hit" notification → existing WS/monitor traffic patterns →
  `markGraphFire`-style store signal → card indicator. Fold keyboard fires and engine fires
  into one signal so the card has a single subscription.
- The indicator must be able to show a fire on a card in the **currently visible list** even
  when the fired graph belongs to another song's section (the "bad bad bad" case). If the
  fired graph is not in the visible list at all, that's fine for this slice — no global
  toast/overlay; just don't crash.

### 3. + Add graph (replaces + New graph)
- The rail's button becomes **+ Add graph**, opening a modal (`lib/ui/Dialog.svelte` — the
  canonical primitive; see `chrome/ShowBrowser.svelte` for the composition idiom).
- Modal lists existing graphs (`store.graphLibrary`), with a filter/search box. Per graph:
  add as **linked** (push the same key onto the active section — reuse by reference) or as a
  **copy** (prompts for a name → `duplicateGraph` + `renameGraph` + add to section).
- The modal also carries its own **+ New graph** form (asks for a name → `createGraph(name)`
  + add to section + open for editing, as today's `newGraph()` does).
- Store verbs that exist already: `createGraph` (2533), `duplicateGraph` (2562), `renameGraph`
  (2547), `addGraphToSection` (2268), `selectGraphInSection`. Prefer composing them; add a
  store method only if composition genuinely can't express it, and test it in
  `store.graphs.test.ts` style (MemStorage + fakeClient harness).

### 4. Sync/linked badge
- A card whose graph key appears in **more than one place** (any section of any song —
  `store.songs` nested `sections[].graphs`) shows a linked indicator. Derive the count with a
  pure helper (unit-tested; `$derived` in the rail may consume it). House rule (AGENTS.md
  memory): reuse is explicit wiring with **visible indicators, never hidden modes** — the
  badge is that indicator; icon + tooltip (icon+tooltip always), e.g. count on hover.

### 5. Context menu
- Right-click on a graph card → `lib/ui/ContextMenu.svelte` (canonical; see its use in
  `TriggerNode.svelte:158-171`). Actions: Rename, Duplicate (into this section), Delete
  (danger — it purges everywhere; say so in the label or a confirm), Remove from section
  (`removeGraphFromSection` — key stays in the library). Wire existing store verbs; rename
  can reuse the EditableRow/RenameField idiom or an inline prompt in the card — your call.

## Anchors to verify before building

- `apps/web/src/lib/app/views/TriggerGraphsRail.svelte` (94 lines) — card markup, fireburst,
  hotkey badges, `newGraph()`.
- `apps/web/src/lib/app/views/graph-thumb.ts` + its test — thumbnail math.
- `apps/web/src/lib/trigger-lab/store.svelte.ts` — verbs at the line numbers cited above;
  they may have drifted a few lines.
- The connected-mode hit path: server voice engine → what the client hears. Do not guess;
  read `apps/server/src/voice-engine-host.ts`, the monitor bus, and `packages/protocol`.
- `apps/web/src/lib/trigger-lab/store.graphs.test.ts` / `store.sections.test.ts` — the test
  harness conventions you must follow.

## Scope fence

May mutate: `apps/web/src/lib/app/views/TriggerGraphsRail.svelte`, `graph-thumb.ts` (+ test),
new component files under `apps/web/src/lib/app/views/` (e.g. `AddGraphDialog.svelte`),
`apps/web/src/lib/trigger-lab/store.svelte.ts` + its controllers/tests (graph/section verbs
and the fire signal only), ui-shot presets, styleguide entry + regenerated
`docs/design-system.html` if you add a reusable composite.

**Only if the fire signal requires it** (verified, not assumed): minimal additions to
`packages/protocol/src/schemas.ts` (+ test), `apps/server/src/voice-engine-host.ts` /
handlers (+ tests), and a pure notification seam in `packages/core` voice engine — core stays
pure (no IO imports; an injected callback/event list, matching how the engine reports today).

Non-goals (do NOT touch): `apps/web/src/lib/app/settings/**` (a sibling slice owns it — hard
fence), `SettingsModal`, graph canvas internals (`TriggerGraphView`, `NodeCard`,
`WireEdge`...), sections bar, songs bar, output/DMX code. Crossing the fence obliges pasting
the diff in your report.

## Code discipline (binding — deviations are review findings)

- Match the file you're editing: naming, comment density (near zero), rune idioms.
  `/efficient-svelte` applies to every `.svelte`/`.svelte.ts` touched.
- Pure logic goes in `.ts` modules with unit tests (the `graph-thumb.ts` / `chain-editor.ts`
  pattern); components stay thin.
- No new dependencies. No hand-rolled modal/menu/tooltip — compose `Dialog`, `ContextMenu`,
  `IconButton`, `EditableRow`, existing tokens.
- No defensive try/catch wrapping, no back-compat shims or feature flags, no dead code, no
  `as any`, no renamed-for-taste refactors outside the fence, no TODO comments in shipped code.
- Icons from the app's existing icon set (lucide) — icon + tooltip, never bare mystery glyphs.

## Non-negotiables (AGENTS.md binds you)

- Compose from `docs/design-system.html`; new reusable composites get a styleguide entry +
  `pnpm design-system` regen in the same change.
- Apply `/make-interfaces-feel-better` before calling UI done.
- Verify with `pnpm ui-shot` captures of the rail (thumbnails + badge), the Add-graph modal,
  and the context menu. `UI_SHOT_BASE` = your worktree pool port (`twux worktree port`),
  never :5173.
- `pnpm test` + `pnpm typecheck` green on **committed HEAD** before push. Push via
  `twux push`; then verify the remote actually has your sha (`git ls-remote`) — do not trust
  the report alone.

## Evidence + report

Effort: **high** (pinned at launch). One PR into `feat/tabbed-chrome` when done (open with
`gh pr create --base feat/tabbed-chrome`). Commit body = the report (<30 lines): what
shipped per issue item (1–5), files touched, test-count delta, ui-shot names, how the fire
signal works connected vs offline, deviations. Completion message to your parent via
SendMessage: one line — sha, branch, PR number, gates status.

## Escalation triggers (stop and SendMessage the orchestrator)

- The connected-mode fire signal can't be built without redesigning the protocol or breaking
  core purity / render-loop determinism.
- Linked-vs-copy semantics turn out to conflict with how sections/songs persist graphs
  (e.g. persistence dedups keys somewhere).
- The rail component turns out to be owned/rewritten by PR #178 or another in-flight branch.
- Any conflict with an AGENTS.md non-negotiable.
