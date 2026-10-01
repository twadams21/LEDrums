# S07 — MIDI-map mode: core + server (S07a), then UI (S07b)

Read first: `00-overview.md`, then the spec section "MIDI-map mode" and user stories 55–62.

## S07a — Mappings in core, host and Sim (runs first)

**Build**

- **`packages/core/src/effect-chain/mappings.ts`** (pure).
  - **Types + zod:** `ControlMapping = { id, source: { midiNote? | midiCc? | oscAddress? | key? }, target, rangeMin?, rangeMax? }`.
  - **Targets:**
    - `fireCell { row, column }`;
    - `fireEffect { effectId }`;
    - `recallSection { songId?, sectionId }`;
    - `param { effectId, device: 'generator' | modifierUid, param }`;
    - `opacity { effectId }`;
    - `modifierMix { effectId, modifierUid }`;
    - `bypass { effectId, modifierUid? }`, a toggle resolved in the web (see below).
  - `mappings` live in the v3 show (`AuthoredV3.mappings`, from S04's passthrough) and in the
    runtime Show.
- **Engine input path** (`voice/engine.ts` and the host).
  - A MIDI note / CC / OSC that matches a mapping source is **consumed** at the same precedence as
    global controls (after them, before zones), and performs its target:
    - `fireCell` / `fireEffect` fire;
    - `recallSection` recalls.
  - **Continuous targets** (`param`, `opacity`, `modifierMix`) become extra modulation on the
    matching Effect's voices:
    - a `cc` / `osc` `ModSource` scaled into `[rangeMin, rangeMax]`;
    - applied every frame, so live knob moves take effect on live voices too.

    Add engine support for modulating Effect opacity and modifier mix if S02 did not expose them
    as params (for example, reserved param keys). Document the choice.
- **Binding-claims** (`voice/binding-claims.ts`). Mappings join the guard: a mapping source that
  collides with a zone note, a global control or another mapping is rejected with a reason the
  UI can show.
- **Server host.** It passes mappings through; its tests cover precedence (global control >
  mapping > zone).
- **Web Sim** (`trigger-lab/sim.ts`, mapping step only). The offline path resolves mappings
  identically; this may come for free if the Sim delegates to the core engine.
- **Web store** (`store.svelte.ts`, mapping API only).
  - `addMapping`, `removeMapping`, `mappingFor(targetId)`.
  - Bypass-toggle targets are applied by the store when the input echo arrives (linked) or local
    MIDI fires (offline). They toggle the authored bypass with an undo step.
  - Key mappings are resolved by the web: a key press matching a mapping performs its target via
    `fireEffect` / recall messages, or the store toggle.

**Fence**

- `packages/core/src/effect-chain/mappings.ts`, `voice/engine.ts` (input precedence + mapping
  modulation), `voice/binding-claims.ts`, `effect-chain/resolver.ts` (mapping modulation), and
  `index.ts`
- `apps/server/src/voice-engine-host.ts`, `handlers/*`
- `apps/web/src/lib/trigger-lab/sim.ts`, `store.svelte.ts` (mapping API)
- Tests

**Acceptance**

- A CC mapping to a generator param changes the rendered output live on an already-playing voice.
- A note mapping to `fireCell` fires that cell and does not fire the zone it would otherwise hit.
- Precedence: global control > mapping > zone.
- A conflicting mapping is rejected.
- Sim versus engine parity for mappings.
- Store key-mapping and bypass-toggle tests.
- Gates: typecheck, targeted vitest, dead-code.

## S07b — MIDI-map mode UI (after S07a and S06)

**Build**

- **Shell state.** A `mapMode` flag. A TopBar "MIDI" toggle button (icon plus tooltip; orange
  when on) and a shortcut (propose `mod+m`; check for clashes in `shortcuts.ts`).
- **A `mappable` Svelte attachment / action** that registers a control with
  `{ targetId, kind: button | toggle | continuous, target: ControlMapping['target'] | globalControl }`.
  Apply it to:
  - grid cells (`fireCell`);
  - Effect and Modifier bypass toggles;
  - Effect opacity and Modifier mix faders;
  - every generator / modifier face param (`param`);
  - section chips (`recallSection`);
  - song / section nav arrows and the other global-control buttons. These map by writing the
    EXISTING `inputMap.globalControls` bindings through the existing learn machinery, so Settings
    stays the source of truth for global controls.
- **While `mapMode` is on:**
  - Every registered control shows an orange (new `--map` token) outline and badge with its
    current binding (for example "C3", "CC 21", "/osc/x", "Key Q").
  - Unmappable UI is dimmed.
  - Clicks select a control to arm instead of acting: a capture layer, with no accidental fires.
  - The armed control pulses.
  - The next MIDI note / CC (midi-controller learn target `map`), OSC address (osc-learn) or
    computer key (a learn-first branch at the top of `dispatchAppKeyboard`, after the
    editable-target check and respecting modal ownership) binds.
  - Delete / Backspace clears the armed control's binding.
  - Escape or the toggle exits.
  - A refused (conflicting) binding shows the binding-claim reason and stays armed.
- Keyboard mappings work outside map mode, and yield to editable targets and keyboard-owning
  controls.
- **Styleguide.** A new section file demoing mappable states (idle, armed, mapped, conflict).
  The orchestrator registers it. Add the `--map` token in `styles/tokens.css`, with contrast
  checked by `pnpm contrast-check`.
- **ui-shot.** Add a `map-mode[:armed]` shot-seam op (S07b owns `shot-seam.ts` now) and capture
  map mode over the Effects view.

**Fence**

- `apps/web/src/lib/app/map-mode/**` (new)
- `app/shell-store.svelte.ts`, `app/shell-nav.ts`, `app/chrome/TopBar.svelte`, `app/app-keyboard.ts`,
  `app/shortcuts.ts`, `app/shot-seam.ts`
- The components that receive the `mappable` attachment (a one-attribute edit each): grid, strip
  cards, section chips, nav arrows, global-control buttons
- `trigger-lab/midi-controller.svelte.ts` / `osc-learn.svelte.ts` (the `map` learn target)
- `styles/tokens.css`, `styleguide/sections/SectionMapMode.svelte`
- Tests

**Acceptance**

- Component tests: arm plus a note binds; key learn binds; Delete clears; Escape exits; a conflict
  is refused and stays armed; clicks don't fire while mapping.
- A key mapping fires a cell outside map mode, but not while typing in a text field.
- ui-shot captures of map mode (idle / armed / mapped) are Read and clean.
- Gates: typecheck, targeted vitest, dead-code, contrast-check.
