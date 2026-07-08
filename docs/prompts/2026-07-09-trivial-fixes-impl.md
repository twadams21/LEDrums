# Impl brief: trivial UI fixes — codex-change review batch (2026-07-09)

**Branch:** `codex/gen3-graph-authoring` (work directly on it; one commit per numbered fix group, conventional messages).
**Context:** an orchestrated review of all changes since `6c9f79f5` found these regressions/defects. Every item here is a verified regression-revert, broken token, or mechanical polish — no design decisions. Do NOT go beyond this list; larger items are deliberately excluded pending owner review.

Read first: `AGENTS.md`, `apps/web/src/styles/tokens.css` (the token vocabulary), and each target file in full before editing.

## Fixes

### 1. Restore the graph signal-flow color system — `apps/web/src/lib/app/views/GraphCanvas.svelte`
Commit `5d29eeb` commented out the wire/handle role colors mid-refactor and never finished. The classes are still stamped (`graph-to-flow.ts` tags edges `mod`/`modulation`/`effect`; `TriggerNode.svelte:226-238` stamps handle classes; `graph-hover.svelte.ts` stamps `edge-hot`). Restore the paint:
- `edge-hot` (~line 208): restore `stroke: var(--accent);` — this is the LOCKED interaction contract "hover highlights connected wires instantly".
- `edge-mod` (~194): restore `stroke: var(--role-mod);` (keep the `5 4` dash).
- `edge-modulation` (~200): restore `stroke: var(--role-modulation);` (keep the `2 3` dash).
- `edge-effect` (~204): give it a real stroke. Check `tokens.css:54-61` — use `--role-effect` if defined, else `--role-mod` (the documented effect-flow pink).
- Handles (~216-232): finish the commented rules — `.mod-handle` restore exactly as commented (it worked before); `.trigger-handle` accent-tinted fill/border as commented; `.effect-handle` role-effect/role-mod tinted as commented. Include the `:hover`/`.connectingto` states.
- Delete any rule bodies that remain empty afterwards; delete the commented-out lines you replaced (no commented-out code left behind).
- Add `aria-label`s (and `title` where a native tooltip helps) to the `Handle` components in `apps/web/src/lib/app/views/TriggerNode.svelte` naming what each port accepts (e.g. "Trigger flow in", "Effect flow out", "Modifier chain in", "Modulation in"). Match the existing `mod-source-handle` title's phrasing style.

### 2. Broken tokens in the Scope inspector (both silently drop declarations)
- `apps/web/src/lib/app/docks/inspectors/ScopeHoopPreview.svelte:188` — `var(--surface-1)` does not exist (ramp is `--surface`/`--surface-2`/`--surface-3`). Use `var(--surface)`. This currently kills the hoop-number chip background.
- `apps/web/src/lib/app/docks/inspectors/ScopeNodeInspector.svelte:173` — `var(--danger)` does not exist; the app's alarm red is `--live`. Use `var(--live)`. This currently leaves the empty-scope error readout uncolored.

### 3. Inspector.svelte hygiene — `apps/web/src/lib/app/docks/Inspector.svelte`
Lines ~74-75: remove the stray blank lines; fix the over-indented `{#if node.kind === 'play' …}` branch (~line 84) to sibling indentation.

### 4. Restore modulation-source inspector headers — `apps/web/src/lib/app/docks/Inspector.svelte:76-108`
Regression: envelope/lfo/cc/note/osc/randomMod nodes used to get a dedicated role header (`<Eyebrow icon={…}>Envelope source</Eyebrow>` etc.) and NO kind-conversion `Select` (a value-emitting source is not a conversion target — converting an envelope into a play node is semantically wrong). They now fall through to the generic kind-dropdown branch. Restore the dedicated headers for all six source kinds and exclude them from the kind Select. Check git history of the file for the prior header markup (`git log -p -- apps/web/src/lib/app/docks/Inspector.svelte`).

### 5. Effect picker polish — `apps/web/src/lib/trigger-lab/EffectGallery.svelte`
- Empty state (~line 170): the bare `<p class="empty">No effects match these filters.</p>` gets a "Clear filters" `Button` (ghost/secondary variant per the design system) that resets scope to `all`, clears `activeTags`, `paramFilter`, and `query`.
- Tokenise raw values: `~:291` `margin: 2px` → nearest space token; `~:339` `line-height: 1.4` → the design-system leading token if one exists (check `tokens.css`; if none, leave and note); `~:363-364` raw `220ms`/`22ms` entrance animation → compose from `--dur-*` tokens (nearest values).
- Reduced motion (~312-319): gate the `.cell` hover `translateY(-1px)` and active `scale(0.98)` transforms behind `@media (prefers-reduced-motion: no-preference)` (the entrance animation is already gated — make it consistent).

### 6. Add pane mechanical polish — `apps/web/src/lib/app/views/AddPalette.svelte`
- Run the repo Prettier config over the file (it shipped with 58 double-quoted literals; the codebase is single-quote).
- `.preview` (~286): `cursor: grab` and `:active { cursor: grabbing }` (it is draggable but shows `pointer`).

### 7. Inspector label-column alignment
`apps/web/src/lib/app/docks/inspectors/OutputNodeInspector.svelte:62-66` and `ScopeNodeInspector.svelte:117-121` hand-roll `.k` label spans with no width, so control edges misalign vs editors using the `Field` primitive (`--field-label-col`). Add `width: var(--field-label-col);` to both `.k` rules (do not restructure to `Field` — that's a later pass).

## Gates (run after all fixes, before final report)

- `pnpm typecheck` (web must be 0 errors)
- Focused web tests for touched areas + full `pnpm test` at the end
- Regenerate the design system: `pnpm design-system` (UI changed → AGENTS.md requires it)
- `pnpm ui-shot` captures of affected surfaces: trigger-graph, node-editor-add, gen3-scope-inspector, effect-gallery (use the existing preset names in `scripts/ui-shot/shots.json`; a sibling agent is extending the harness — presets are guaranteed to keep working, `git pull` before running if invocation fails)
- Pull/rebase before each commit; a sibling agent commits to this branch concurrently (it owns `scripts/ui-shot/**`; you own the files above — conflicts should not happen).

## Report

`twux send-message --session parent --status done|blocked --body "<per-fix commit shas, gate results, ui-shot paths, any deviations>"`
