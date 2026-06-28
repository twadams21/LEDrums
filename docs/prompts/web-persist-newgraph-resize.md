# Live persistence + create-new-graph + resizable docks (web)

Implementer agent. Three related web features, do them in THIS ORDER (each builds on the last). Apply
**/codebase-design** (pure modules behind small interfaces, like `shell-nav`/`setlist`/`show-builder`)
and **/make-interfaces-feel-better** for the resize handles. Branch **`feat/unified-shell`** (checked
out). Report to your parent orchestrator (`--session parent`). No push/PR/merge. Commit a milestone
after EACH of the three.

## File boundaries (shared working tree — siblings run concurrently)
YOU OWN: `apps/web/src/lib/trigger-lab/store.svelte.ts`, `apps/web/src/lib/app/**` (AuthorShell,
PerformShell, SectionsView, chrome/, docks/, a new `lib/ui/Splitter.svelte`), and a NEW persistence
module + test under `lib/app/` or `lib/trigger-lab/`.
DO NOT TOUCH: `packages/core/**` (sibling A), `apps/web/src/lib/visualizer/Scene.svelte` (sibling B),
`apps/web/src/App.svelte` (sibling B may touch its keydown). Use package-scoped gates
(`pnpm --filter @ledrums/web typecheck && test`); if a web gate shows errors only in Scene.svelte /
App.svelte / core, that's a sibling mid-edit — ignore + re-run.

## 1. Live persistence (FOUNDATION — do first, commit)
Everything the user authors must be saved LIVE (no save button) and reloaded automatically next time.
- Pure module (testable in node, no DOM): `persistence.ts` — `serializeAuthored(store-slice) →
  JSON-safe object`, `deserializeAuthored(raw) → slice | null` (returns null on version mismatch /
  malformed, so a bad blob never wedges boot), with a `VERSION` constant in the key/payload.
- Persist the AUTHORED state only (not transient voice/frame/link state): `graphs`, `songs`,
  `buses`, `presets`, `effects`, `selectedPadKey`, `activeSongId`, `arrangeSectionId`, `bpm`,
  `velocity`, `beatsPerBar`. (Pane sizes get added in step 3.)
- Store: on construction, hydrate from `localStorage` BEFORE `start()`/WS connect (so the first
  `setShow`/`recallSection` reflects the restored content). Then a debounced (~300ms) `$effect`
  autosaves on any change to the authored state. Key e.g. `ledrums:authored:v1`. Guard SSR/no-localStorage.
- Unit-test the pure module (round-trip; version-mismatch → null; partial/missing fields tolerated).
- Verify: edit something (add a graph / move a node / change a slot), reload :5173, see it restored.

## 2. Create a new graph (commit)
The graph library is currently the static per-pad fixtures. Add authoring:
- `store.createGraph(name?) → key`: makes a fresh `TriggerGraph` (just a `trigger` node via
  `makeNode('trigger','trigger')`) under a new unique key (e.g. `graph:<nid>`), adds it to `graphs`,
  and surfaces it in `graphLibrary` with a label (use the given name or "New graph N"). New graphs
  are editable via the existing NodeCanvas (set `selectedPadKey` to the new key) and persist (step 1).
- Surface it in the SectionsView graph-picker drawer as a "+ New graph" tile (creates + assigns to the
  pending slot + optionally jumps to the Trigger Graph view to edit). Keep `graphLabel` working for
  both pad-derived keys and authored keys.
- Note: `graphLibrary` is currently derived from `pads`; extend it to include authored graphs too.

## 3. Resizable docks / panes (commit)
Make the shell layout user-resizable, sizes persisted live (reuse step 1):
- A reusable `lib/ui/Splitter.svelte` — a draggable divider (pointer drag; keyboard arrows;
  ≥40px hit area via a pseudo-element; reduced-motion fine; subtle hover/active affordance per
  make-interfaces-feel-better). Emits size changes; caller persists.
- AuthorShell: make the **left rail width**, **right dock width**, and **bottom dock height**
  drag-resizable (the grid-template tracks become CSS vars driven by persisted sizes). Add splitters on
  the divides. Sensible min/max clamps. Persist each size (extend the persistence payload, bump VERSION
  or add fields tolerantly).
- Perform shell: make the songs-rail width (and the 3D|2D split if practical) resizable too.
- Restored on reload via step 1.

## Gate + report (after all three)
Run the FULL gates and paste output: `pnpm typecheck` + `pnpm test` (do not claim green otherwise).
Sanity-check on the running :5173 stack (resize a dock, reload, confirm restored; add a graph, reload,
confirm present). Then:
```
twux send-message --session parent --slice-status "<short>" --body "<the 3 features, the pure persistence module + interface, what state persists, the Splitter approach, tests added, pasted typecheck+test output, anything flagged>"
```
If you hit the usage limit mid-edit, commit WIP and stop (resumes after reset).
