# Wave 4 report — design audit/critique + polish

Branch `wave-4/polish` (off merged rock-solid). Commits, in order:
`7498203` (B: inspector field redesign) · `2d4d754` (C: preview full coverage) ·
`a6c0194` (D: styleguide demos) · this report + gate.

**Method note (deviation, honest):** the `/impeccable` skill is not installed in this
environment. The wave ran in its audit/critique spirit instead — every named surface
captured headlessly with `ui-shot` at **1280×800 and 1920×1080** (PNGs read, not just
generated), critiqued against `PRODUCT.md` (Linear-inspired, Resend-dark, "dense but never
noise"), fixed, re-shot. `/make-interfaces-feel-better` applied on every change
(before/after tables below).

Full gate green at the end: `pnpm design-system` regenerated; `pnpm typecheck` all 5
packages 0 errors; `pnpm test` **core 548 · io 13 · protocol 1 · server 204 · web 1064, 0
skips**; `ui-shot --all --strict` clean console at BOTH viewports (own dev server on
:5178/:4326 — the wave-3 stale-server trap avoided; NB the server reads `PORT`, not
`LEDRUMS_WS_PORT`, for its listen port).

---

## A. Full design audit — findings

Every named shot reviewed at both viewports. The shell reads coherently: wave-3's unified
PanelHeaders hold everywhere, the approved layout scales well from 1280 to 1920 (canvas and
dock absorb the growth; rails stay fixed — correct), Perform/Objects/Sections/Patch/Monitor
are consistent in header treatment, icon language and list rhythm.

**Fixed (details in B/C below — the two biggest audit findings were the assignment's own
locked items):**
1. **Inspector fields had two competing label systems and no shared height** — Field-based
   editors used stacked sentence-case labels; the node-kind editors used a hand-rolled
   `.lblrow` with uppercase 56px labels; TextField (7px pad) vs CommitInput (space-1 pad) vs
   Select (space-1 pad) vs SearchField (32px pill) each sat at a slightly different height.
   → item B.
2. **Eight node kinds had blank faces** while play/envelope/LFO/CC had live previews —
   inconsistent card language on the canvas. → item C.
3. **Section inspector's read-only recall strings wore full-size input-like boxes** —
   read-only data dressed as editable fields (hierarchy lie). Compacted to slim code chips;
   editable = sentence-case label + control, read-only = uppercase micro-label (ReadRow)
   is now the consistent rule.
4. **`song-library` named shot never left the Songs detail** (scrollTo a rail row doesn't
   activate it) — the shot was a duplicate of `objects`, hiding the actual Song Library
   surface from every future agent. Fixed to click the rail row; the view itself was fine.
   Also added a `node-editor-play` named shot (the play-node editor was previously
   unphotographable).

**Judged fine / deliberately kept:**
- **Buses/Layers "no voices" cards** — constant height, locked decision 3. Kept.
- **Node Editor add-palette rhythm** (40px tiles, roomy rows) — reads as Linear's command
  palette; density here would hurt scan-ability. Kept.
- **Perform 2D map empty swatches** offline — data-dependent (fills under live frames),
  not a design defect. Kept.
- **Monitor** — diagnostic surface, mono grid is its job. Kept.
- **SearchField pill** — kept the pill idiom (search affordance) but pulled 32→28px toward
  the control rhythm.
- The approved shell layout itself — untouched, per assignment ("polish, don't re-lay-out").

## B. Inspector field redesign (locked decision 4) — the big one

**What changed.**
- **Tokens:** `--control-h: 26px` (canonical text/select control height) and
  `--field-label-col: 6.5rem` (the shared label column) in `tokens.css`.
- **Field** gains `layout="row"`: label column left (vertically centred, ellipsised),
  control right, hint under the control — the Linear properties-panel rhythm. `stack`
  stays the default for dialogs/wide forms (AppSettingsDialog, EffectCreator untouched).
- **One height:** TextField / CommitInput / Select trigger all sit at `--control-h` with
  `0 var(--space-2)` padding; SearchField 32→28px.
- **Sweep:** all 32 `<Field>` usages across the 10 Field-based inspectors →
  `layout="row"`. The five node-kind editors' hand-rolled `.lblrow/.k` rows were unified
  onto the same rhythm: sentence-case muted medium labels at `--field-label-col` (uppercase
  tracking dropped — now reserved for read-only rows), selects fill the control column,
  the 60% slider cap and space-between toggle rows dropped.
- **SectionInspector:** look-rows aligned to the shared column; recall `rcode` chips
  compacted.
- **Styleguide:** new "Field · row layout" demo documenting the rhythm (same change).

**/make-interfaces-feel-better — before → after:**

| Detail | Before | After |
|---|---|---|
| Label treatment | 2 systems: stacked sentence-case vs uppercase-tracked 56px inline | ONE: sentence-case muted 10px medium, 6.5rem column, editable-only |
| Control height | ~30px TextField, ~26px CommitInput/Select, 32px search | one `--control-h` (26px) everywhere; search 28px pill |
| Vertical rhythm | label-above rows ≈ 46px each | label-beside rows ≈ 26px — ~40% denser, aligned grid lines |
| Hints | inline after label (stack) | under the control, 10px faint (row) — read after the value, not before |
| Read-only values | boxed like inputs (`--space-2` pad) | slim code chips (`--space-1` pad), uppercase micro-labels |
| Alignment | Name / Looks / Recall columns all different | every control's left edge on one grid line |

**Evidence.** `trigger-node-selected`, `section-detail`, `node-editor-play` re-shots — the
trigger editor now reads Trigger source / Drum / Zone / Name as four aligned rows; the
section editor's Name, Looks and recall rows share one label column.
**Files.** `styles/tokens.css`, `ui/Field.svelte`, `ui/TextField.svelte`,
`ui/CommitInput.svelte`, `ui/Select.svelte`, `ui/SearchField.svelte`, 15 files under
`docks/inspectors/`, `styleguide/sections/SectionPrimitives.svelte`.

## C. Node preview full coverage (locked decision 1)

**What changed.** Every remaining kind now has a face — new `NodeStatePreview` on the
shared `SignalFace` ticker (viewport-gated, reduced-motion static frame), rendered through
`NodeCard`'s existing thumb slot, in the kind's tint token:

| Kind | Static face | Trigger-driven response |
|---|---|---|
| chance | donut arc filled to `p` | arc flash |
| toggle | power ring | flips filled/hollow per fire (display-only approximation; resets on mount) |
| delay | empty wait bar | fills across `computeDelayMs` after a fire; arrival flash when the deferred children fire |
| sequence | one dot per wired child | cursor advances a step per fire |
| all | 1→N fan | every line flashes |
| random | 1→N fan | ONE line flashes per fire — deterministic from the fire epoch (`firePick`) |
| switch (gate) | threshold bar + cutoff marker | frame flash |
| switch (other) / bands | fan / existing `BandSwitchNode` | flash / unchanged |
| modifier | S-curve transform glyph | curve lights |

- **Seam:** pure `firePulse` / `firePick` / `delayProgress` beside `triggerClock` in
  `signal-preview.ts` (+9 tests, 26 total in the file); trigger epoch =
  `store.selectedGraphFireAt`, exactly as the wave-3 seam intended.
- **LFO / CC untouched** — continuous (locked decision 2).
- **Safety:** display-only (no engine-state reads — determinism intact); the per-fire
  step/flip `$effect` reads `fireAt` and writes only a local counter (the self-referential
  class stays unwritable); `draw()` null-guards the node against rAF-outlives-node.

**Evidence.** `trigger-graph` re-shot (modifier S-curve live on the seed graph, clean
strict console); the styleguide's new state-preview demo shows all 8 faces with a Fire
button; unit tests cover the pure geometry.
**Files.** `views/NodeStatePreview.svelte` (new), `views/TriggerNode.svelte`,
`trigger-lab/signal-preview.ts` + test.

## D. GraphsDock styleguide demo (WAVE3 follow-up)

`SectionGraph` gains a **store-free markup stub** of the Graphs dock — PanelHeader with
section tabs + hotkey hint, hotkey-badged graph cards over real `graphThumb` mini-map
projections, the dashed new-graph card — with the src pointer at the real
`app/views/GraphsDock`. Plus the state-preview DemoCard (C) so every new component is
demoed in the same change. `pnpm design-system` regenerated once at the end.

## Surprises / notes

- **`pnpm dev` ignores `LEDRUMS_WS_PORT` for the server side** — the server listens on
  `PORT`; without it the server EADDRINUSEs against a sibling worktree on :4321 and every
  shot logs a WS proxy error. Run `PORT=4326 LEDRUMS_WEB_PORT=5178 pnpm dev`. Worth
  aligning the env names or teaching `scripts/dev.mjs` to map one to the other.
- **`song-library` shot was silently a duplicate of `objects`** since it was added —
  `scrollTo` doesn't click. Anyone "verifying" the Song Library from shots was looking at
  the wrong surface.
- `/impeccable` skill absent in this environment (deviation noted above).
- Toggle/sequence faces approximate engine alternation/step locally (per-fire counters);
  true engine-state mirroring would need a per-node state export from the sim — noted as a
  possible future nicety, deliberately NOT added (previews stay display-only).
