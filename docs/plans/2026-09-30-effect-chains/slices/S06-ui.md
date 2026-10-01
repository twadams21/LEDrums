# S06 — Effects view UI: grid (S06a), device strip (S06b), sections / objects / import (S06c)

Read first: `00-overview.md` (including the orchestrator-owned files list, which binds in this
parallel wave), then the spec sections "Web UI", "Grid and navigation", "Effect chain and device
strip", "Triggers", "Target" and "Presets and files". Also read `PRODUCT.md`, `DESIGN.md` if
present, `docs/design-system.html` (the styleguide contract) and `apps/web/src/lib/styleguide/`
README.

These three slices run IN PARALLEL on file-disjoint fences. All consume the S05 store API. All
must apply `/make-interfaces-feel-better`, use or extend the design system, and follow the
keyboard-ownership pattern (`.mex/patterns/keyboard-ownership.md`).

## UI conventions

Stay close to the existing conventions:

- Linear-inspired, Resend-dark.
- Icon plus tooltip on every icon button.
- The existing tokens and role colours: generator = `--role-content`, modifier = `--role-effect`,
  controls = `--role-mod`, trigger = `--role-input`, target = `--role-output`.
- No lift or click animations.
- Instant hover.
- Tabular numbers for values.

Reference pattern: **Ableton Live's Device View.**

- A horizontal chain of fixed-height device panels along the bottom.
- Each device has a title bar with a power (bypass) toggle, the device name and a fold toggle.
- Controls sit laid out on the panel face.
- The chain scrolls horizontally.
- Drag a device to reorder it; a drop slot appears at the end of the chain.
- A "+" at the end adds a device.

Match that interaction model; don't invent a new one.

---

## S06a — Grid + Effects view integration

**Build**

- **`EffectsView`** replaces `TriggerGraphView` as the `trigger` editor view in `lazy-views.ts`.
  Rename the tab label to "Effects", with a fitting lucide icon.
  - Layout: the Grid on top, and a resizable splitter with the device strip below. Persist the
    height in `paneSizes`, like the existing pane sizes.
  - The strip area mounts `<DeviceStrip store={store} cell={selectedCell} />` from S06b.
  - Until S06b lands, import it from `app/views/effects/strip/DeviceStrip.svelte`. S06b creates
    that file; agree to exactly these props. If you need to compile before it exists, create a
    one-line placeholder at that path and say so; the orchestrator resolves it at merge.
- **Grid** (`app/views/effects/grid/**`).
  - Rows: Kit plus each drum, in kit order.
  - Columns: the union of zone slots across drums, labelled by zone name where consistent,
    otherwise "Zone N". Then Always / Clock / Cue.
  - Cells a drum doesn't have (and zone cells on the Kit row) are disabled.
  - The Master cell sits at the Kit row's start (or a clearly labelled corner).
  - Each cell shows:
    - its Effect count / stack pips;
    - the first Effect's name and generator icon;
    - bypass state;
    - a live fire flash from `cellFireAt` (instant on, short decay, with no layout shift).
  - Interaction:
    - click selects;
    - double-click an empty cell opens a Generator picker to add an Effect;
    - arrow keys give roving focus; Enter selects;
    - the context menu offers add, copy, paste, clear, "Save cell to file…" and "Load file into
      cell…".
  - The grid follows the active section. It must look right from 1 to 8 zones per drum and 4–6
    drums.
- **Keyboard audition.** Keys 1–9 / 0 call `store.fireEffectAt(n)` via the existing app-keyboard
  graph-digit path. Keep the ownership rules.
- **shot-seam ops.** S06a owns `shot-seam.ts` in this wave.
  - Add `cell:<row>:<col>` (select), `add-effect:<kind>[:style]` (into the selected cell),
    `effect-stack:<n>` (fill the selected cell with n demo Effects) and `master` (select the
    Master).
  - Report new `shots.json` presets for the orchestrator: grid-empty, grid-populated,
    grid-selected, grid-master.
- **Styleguide.** New section file `styleguide/sections/SectionEffectsGrid.svelte` with GridCell
  states. Do not edit `Styleguide.svelte`.

**Fence**

- `apps/web/src/lib/app/views/effects/grid/**`, `app/views/effects/EffectsView.svelte`
- `app/lazy-views.ts`, `app/chrome/ViewTabs.svelte`, `app/app-keyboard.ts` (audition),
  `app/shot-seam.ts`, `app/AuthorShell.svelte` (selection sync if needed)
- `styleguide/sections/SectionEffectsGrid.svelte`
- Tests beside them

---

## S06b — Device strip + device cards

**Build** (`app/views/effects/strip/**`)

- **`DeviceStrip.svelte`** has props `{ store, cell }`. It renders the cell's stack: one chain row
  per Effect, in stack order, with drag to reorder Effects within the stack. For the Master cell,
  it renders one modifier-only chain.
- **Effect header:**
  - name (inline rename);
  - bypass power toggle;
  - blend Select;
  - opacity fader;
  - retrigger Select;
  - a menu with Save to file…, Load file into Effect…, Duplicate and Delete.
- **Cards** (fixed width, readable; the chain scrolls horizontally; every param is on the face):
  - **Trigger** — the kind, shown as a Select that moves the column. Kind-specific settings:
    - zone: the zone label (read-only);
    - Clock: every (beat division) and offset;
    - Cue: MIDI note / CC / OSC with Learn buttons, using the S05 cue learn.
    
    Plus the amp envelope, as a compact ADSR editor. Reuse `CurveField` / `EasePicker` /
    envelope editor pieces where they fit.
  - **Generator:**
    - the kind picker (icons for the 11 kinds);
    - a Style Select;
    - a live `EffectThumb`;
    - the params from core `generatorParamSpec`, via `FaceParamControl` (or `ParamRow` where a
      full control is clearer).
    
    For Splice / Slice, show the slots editor (colour or nested generator per slot) plus its
    settings. Reuse or reshape the existing Splice / Slice inspector parts.
  - **Modifier** — power toggle, name, params, Mix fader, and an optional envelope (collapsed by
    default). Drag to reorder.
  - **Control** — kind-specific settings (Envelope / LFO / Velocity / Random / CC …) and a
    mappings list: add a mapping by picking a device and param, then amount, invert and range.
    Modulated params show the existing "modulated" indicator on their cards.
  - **Target** — a segmented control for Kit / Hit drum / Select. For Select, pick drums and
    optionally hoops (reuse the Scope hoop preview / picker pieces).
  - **"+" slots** — "+ Modifier" (the palette grouped by category, from core `modifiers/palette`)
    and "+ Control".
- Every edit calls the S05 store API. Drags use `beginGesture` / `endGesture`.
- **Styleguide.** New section file `styleguide/sections/SectionDeviceStrip.svelte` demoing every
  card and a stacked strip, with fixture store data. **Verify via the styleguide page
  (`/?style`) with ui-shot**, since you cannot select grid cells in this wave.

**Fence**

- `apps/web/src/lib/app/views/effects/strip/**`
- `styleguide/sections/SectionDeviceStrip.svelte`
- New reusable primitives under `apps/web/src/lib/ui/` only if genuinely reusable (each with a
  demo in your section file)
- Tests beside them

---

## S06c — Sections view, Objects view, import UI

**Build**

- **Sections view** (columns per section). Replace graph rows with a compact per-cell / Effect
  summary: row = cell, showing its effect names. A click selects the section and cell and opens
  the Effects view.
  - Keep reorder, copy, paste and move of sections.
  - Stop using linking UI (`GraphPickerDrawer`, `LinkPlacementDialog`): unmount it here; S08
    deletes it.
  - Section menu: replace "Load graph from file…" with "Load cell / effect from file…".
- **Objects view.** Drop the graphs and presets rows. Keep songs, canvas scenes and library rows,
  and show Effect counts per section where the view lists sections.
- **Import UI.**
  - When `store.legacyImportAvailable`, show a dismissible notice (toast or banner, per existing
    patterns) offering "Import shows from the previous version". It explains that kit, patch and
    inputs are kept, graphs are not carried over, and the old data is left untouched.
  - Add the same action to the setlist / show menu.
  - A confirm dialog lists the shows to import.
- **Styleguide.** A new section file for any new composite.
- ui-shot `view:sections` and `view:objects` captures (existing ops), plus the import prompt
  (report a shot preset).

**Fence**

- `apps/web/src/lib/app/views/Sections*.svelte`, `SectionColumn.svelte`, `SectionGraphRow.svelte`
  (rename or replace allowed), `ObjectsView.svelte` and its row components, `objects-view.ts`
- `app/section-actions.ts`, `app/chrome/SongsBar.svelte` (show menu), the import dialog / notice
  (new files under `app/import/`)
- `styleguide/sections/SectionImport.svelte` if needed
- Tests beside them

---

## Acceptance (all three)

- Typecheck passes; targeted vitest passes (component tests for grid keyboard nav, card param
  edits and import flow); dead-code passes.
- ui-shot captures Read and clean, with no console errors.
- `/make-interfaces-feel-better` notes are in the commit body.
- Reusable components have styleguide demos (the orchestrator registers the section and
  regenerates `docs/design-system.html`).
