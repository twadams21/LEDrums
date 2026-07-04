# Effects Library v2 — play types, canvas engine, gallery redesign, Gen-3 rehab

**Status:** PLANNED — not started. This doc is the durable source of truth; the
[status tracker](#status-tracker--resume-protocol) at the bottom is updated as slices land.
**Anchors verified:** 2026-07-05 (lines drift — re-anchor by symbol).
**Prereq reading:** `docs/plans/2026-07-05-effects-system-review.md` (the review that
produced the emission contract + Gen-3 effects), Rock Solid docs 06/10
(`docs/plans/2026-07-02-rock-solid/`) for the modifier/modulation node designs this
composes with.

---

## Vision

One drum kit exists in the world. The effects library should read like it knows that:
effects are physical events in a 3D object, authored from a rich day-1 library, extensible
by DATA (authored canvas scenes, transform chains, presets) rather than by code — so the
data structure / API layer never has to change to add a new look. The gallery is the shop
window: every effect has a description, tags, visible parameters, and a thumbnail rendered
on the same fake drum so likes compare with likes.

Four workstreams, in dependency order:

- **A. Metadata + gallery redesign** — descriptions, tags, param pills, filters, fake-drum
  thumbnails.
- **B. Library rehab** — lift every pre-Gen-3 effect to the Gen-3 bar (emissions,
  descriptions, 3D-awareness), merge near-duplicates, retire the rest behind an alias map.
- **C. Play types** — the play node grows a `playType`; the **canvas** play type (2D scene
  → sampled through drum geometry placements + coordinate-transform lenses) is the
  extensibility engine.
- **D. Day-1 library fill + verification** — authored canvas/lens presets, ui-shot suite,
  determinism + perf gates.

---

## Current state (verified anchors)

### Effect hosting
- `EffectGenerator` seam: `packages/core/src/effects/types.ts:43-63` (`paramSpec`,
  `timebase?`, `createState?`, `render(ctx, params, fb, state)`). 45 generators registered
  (`effects/registry.ts`); emission contract at `effects/emitter.ts` (Gen-3, 2026-07-05).
- **Two render paths** in the voice compositor (`packages/core/src/voice/compositor.ts:173-190`):
  generator-backed (`generator-bridge.ts:78-167`, synthetic single trigger, timebase switch
  at :116-138) and **pattern-backed** (`voice/pattern-renderer.ts:110-175` — 10 legacy
  procedural patterns: flash/chase/sparkle/ripple/swirl/aurora/drift/radial/haze/strobe,
  sampled per-pixel from SoA `PixelAttrs`).
- UV/field sampling already exists: `effects/field.ts` (`UvMode` cylindrical/planar-xy/xz/yz,
  `renderUvField`), every `Pixel` carries `uv`, `angleDeg`, `normHoop`, `world`, `tangent`,
  `normal`, `hoopIndex`, `indexInHoop`, `segmentLengthMm` (`geometry/pixel-model.ts:26-49`).
  `getHoopPixelRange` (:202-212) resolves hoop ranges. This is the raw material for the
  canvas sampler — no new geometry needed.

### Graph / node model
- `GraphNode` (`packages/core/src/voice/types.ts:240-322`): play fields (`effectId`,
  `presetId`, `busId`, `mode`, `scope`, `targetId?`), modifier fields (`modifierId?`,
  `bypass?`), modulation-target `modInputs`, source settings (`lfo`, `cc*`, `oscAddress`).
- `NODE_KINDS` (`apps/web/src/lib/trigger-lab/sim.graph-compilation.ts:54`):
  `play · all · random · sequence · switch · chance · toggle · delay · modifier · envelope · lfo · cc`.
- Play → voice: `voice/eval-graph.ts:170-193` builds `PlayAction {effectId, mode, scope,
  targetId, busId, params, modifiers?, modulations?}`; modifier chains resolve via
  `resolveModifierChain`, modulations via `param:<key>` edges (`modulation-graph.ts:84-110`).
- **Already landed** (Rock Solid): 18 modifiers (`core/src/modifiers/registry.ts`, chain
  runner `chain.ts:34-58`), modulation sweep `compositor.ts:60-81`
  (`applyEffectiveParams` + `modCtxFor`), LFO waveforms (`voice/lfo.ts`). The canvas play
  type inherits ALL of this for free (modifiers post-process its framebuffer; modulation
  drives its params).

### Gallery / thumbnails
- `EffectGallery.svelte`: Dialog opened via `store.openGallery(node)`
  (`store.svelte.ts:2919-2924`); scope tabs drum/kit (:40-43); search over name+pattern
  (:33-38); card grid `minmax(170px,1fr)` (:129); pick → `store.pickEffect` (:80-90).
- `EffectThumb.svelte`: generator path (:188-205, `renderGeneratorThumbFrame`) vs pattern
  path (:206-219, `sampleWith`); paints a raw 26×13 grid (`fillRect` per cell); shared
  ticker + IntersectionObserver; reduced-motion static frame at 400ms. Sizes: gallery
  170×92, inspector 72×40, clip settings 84×46.
- Thumb model: `trigger-lab/kit.ts:103-193` (`THUMB_COLS 26 / ROWS 13 / RADIUS 100mm /
  SPACING 12mm`, real cylindrical world coords, single drum `'thumb'`).
- Metadata flow: core registry → `fixtures.ts:148-163` (`GENERATOR_EFFECTS`, param mapping
  :103-142, total coverage) → `EffectDef` (`sim.ts`). **No description/tags/deprecated
  fields anywhere.** No deprecation mechanism; `applyAuthored` unions built-ins on hydrate
  (`store.svelte.ts:1016-1018`) so removed effects would resurrect — retirement must be a
  flag, not a deletion.
- Dev server for ui-shot: **:4321 / :5173 running** (see `scripts/ui-shot/README.md`).

---

## Design

### D1. Effect metadata (additive to the seam — the API doesn't change shape)

```ts
// packages/core/src/effects/types.ts — EffectGenerator gains:
description?: string;      // 1–2 sentences, gallery card + inspector; written like the
                           //   Gen-3 blurbs (what it does + why it's cool on THIS kit)
tags?: readonly string[];  // from the controlled vocabulary below
deprecated?: { replacedBy: string; note?: string };  // hidden from gallery; alias target
```

**Tag vocabulary (controlled, one source of truth in core):**
- *Reactivity:* `hit` (per-hit emission), `ambient`, `meter`, `beat-synced`
- *Space:* `3d` (world-space), `per-drum`, `kit-wide`, `hoop-aware`, `airspace` (uses the
  gaps between drums)
- *Look:* `band`, `wave`, `particle`, `texture`, `wash`, `strobe`, `sparkle`
- *Engine:* `emission`, `canvas`, `lens`, `stateful`, `seeded`
Tags are data, not code paths — the gallery filters on them; nothing else may branch on them.

**Category rework:** current `EffectCategory` (base/trigger/wash/meter/utility/texture/
particle) stays as the *engine* category; the gallery's primary grouping becomes
user-facing **collections** derived from tags: `Hits` (hit+), `Waves & Ripples`,
`Particles & Air`, `Textures`, `Ambient & Base`, `Meters & Utility`. Mapping lives in one
web-side table; effects can appear in one collection only (first match wins, ordered).

**Alias map** (`packages/core/src/effects/aliases.ts`): `Record<oldId, newId>` consulted at
show hydrate + `setShow` so existing shows referencing retired ids keep working forever.
Aliased ids never appear in the gallery.

### D2. Library disposition (Gen-3 bar: description + tags + per-hit emissions where trigger-driven)

Quality bar = the Gen-3 four: emission-based multiplicity for anything hit-launched,
3D/geometry awareness where it earns it, seeded determinism, no hot-path allocation,
a real description.

| Disposition | Effects | Notes |
|---|---|---|
| **Retire → alias** | `chase` → `chase-bands` · pattern `chase` → `chase-bands` · pattern `ripple` → `ripple-3d` · pattern `strobe` → gen `strobe` · pattern `flash` → `whole-drum` · pattern `radial` → `radial-wash` · remaining patterns (`sparkle`→`pixel-accum`, `swirl`→`helix`, `aurora`→`perlin-clouds`, `drift`→`temp-sweep`, `haze`→`lava-lamp`) | Kills the whole legacy pattern path eventually (keep `pattern-renderer.ts` until D-phase confirms nothing references it, then delete) |
| **Merge** | `burst` + `radial-wash` → one `radial-wash` (emission-lifted; burst's per-hit pop = short-life preset) · `colour-melody` folds into `whole-drum` as a `noteHue` bool param | Merge = keep the better id, alias the other, union the params |
| **Lift (mechanical batch)** | `follow-hoop`, `wipe-3d`, `pixel-accum`, `swing`, `sidechain`, `sacred-hogs`, `collisions`, `velocity-flames`, `wave-collapse` | Emissions where hit-driven; descriptions+tags; audit kit-fraction reaches (spark-arc lesson: drum-relative distances derive from `drum.radiusMm`) |
| **Keep (describe+tag only)** | `solid-base`, `whole-kit`, `strobe`, `synced-hoops`, `meter-eq`, `breathing-kit`, `hue-rotate-kit`, all 12 UV textures, `starfield`, `comet-trails`, `lightning`, `confetti-burst`, `helix`, `orbit-rings`, `gravity-wells`, `temp-sweep` | Gen-2 textures/particles already meet the bar minus metadata |
| **Gen-3 (done)** | `chase-bands`, `ripple-3d`, `spark-arc`, `rain-3d` | Descriptions exist in source docblocks — extract into `description` |

An early slice (B1) re-audits this table against source before the batch runs; the table is
the default, not gospel.

### D3. Play types — the extensibility seam

The play node gains a **`playType`** discriminant (default `'hosted'` — today's behaviour,
zero migration):

```ts
// GraphNode play fields gain:
playType?: 'hosted' | 'canvas';        // future: 'scene3d' | …
canvas?: CanvasSceneRef;               // playType 'canvas' only
```

- **`hosted`** — the existing `EffectGenerator` path, unchanged. All 45 effects.
- **`canvas`** — the new engine (D4). Voice carries `canvasScene` instead of `generatorId`;
  compositor grows a third dispatch branch beside generator/pattern
  (`compositor.ts:173-190`). Modifier chains and modulation sweep apply identically (they
  operate on the framebuffer / on params — playType-agnostic by construction).
- **Deliberately NOT a play type:** coordinate transforms. A transform is a *lens* in the
  canvas sampling chain (D5) — making it a play type would fork the engine; making it a
  lens makes it compose with every canvas scene. (Design-it-twice outcome: rejected
  "transform play type" and "transform as framebuffer modifier" — a modifier sees pixels,
  too late to bend coordinates.)
- Seam test: one voice determinism test per playType at the compositor seam, mirroring
  `voice/determinism.test.ts`.

### D4. The canvas play type (core engine, pure)

A canvas effect = **a 2D scene document sampled through a placement of the kit's geometry
onto that canvas**. Authored as DATA → new looks without new code.

```ts
// packages/core/src/canvas/types.ts (new)
interface CanvasScene {
  id: string; name: string;
  description?: string; tags?: string[];
  elements: CanvasElement[];           // painter's order
  sampler: SamplerConfig;
  lenses?: Lens[];                     // coordinate-transform chain (D5)
}
type CanvasElement =
  | { kind: 'stripes'; angleDeg; widthU; duty; speedUps; hue; sat; softness }
  | { kind: 'circle';  cx; cy; r; feather; hue; sat }
  | { kind: 'gradient'; angleDeg; stops: {at; hue; sat; v}[] }
  | { kind: 'polygon'; cx; cy; sides; r; rotDeg; feather; hue; sat }
  | { kind: 'checker'; cols; rows; hueA; hueB; phase }
  | { kind: 'noise';   scale; octaves; hue; sat; speed };
  // v1 set — additive union, renderers are tiny pure fns of (u, v, t, el)
```

**Samplers** (how drum geometry lands on the canvas — the "switch in the canvas node"):
- `hoop` — each hoop is a circle placed on the canvas (position/radius per hoop or auto
  grid); pixel samples at its angle around that circle. Trent's Resolume stripes-through-
  hoop effect is: `stripes` element + `hoop` sampler.
- `strip` — the drum's pixel chain unwound as a straight line laid across the canvas
  (uses `indexInHoop`/`hoopIndex` → arclength position; direction/spacing params).
- `cylinder` — existing `Pixel.uv` (angle × hoop-height) mapped to a canvas region.
- `footprint` — kit-wide planar projection (existing planar-xz), whole kit on one canvas.

**Scene-level animation/modulation params** (exposed via the standard `paramSpec` so the
Inspector, envelopes, LFOs and CC drive them with ZERO new UI): `canvasRotDeg`,
`canvasOffsetX/Y`, `canvasScale`, `samplerRotDeg` (hoop rotation!), `speed`, `brightness`,
`hue` (global rotate). The canvas engine is an `EffectGenerator` *adapter* internally —
`render(ctx, params, fb, state)` — so it slots into the bridge/thumbnail machinery
untouched; `playType:'canvas'` selects a scene doc where `hosted` selects a generator id.

**Scene documents** are authored objects like presets: seed library ships in core
(`canvas/presets.ts`), user-authored ones live in the show document (Objects view gets a
Canvas Scenes section), clipboard-portable via the existing ClipDoc plan (Rock Solid doc 11).

### D5. Lenses — coordinate transforms as first-class data

A `Lens` is a pure `(u, v, t) → (u, v)` warp applied between sampler and elements
(chainable, ordered):

```ts
type Lens =
  | { kind: 'polar' }                    // xy → (angle, radius): stripes become rings,
  | { kind: 'unpolar' }                  //   rings become stripes
  | { kind: 'log-polar'; zoom }          // infinite-zoom tunnels
  | { kind: 'kaleido'; sectors; spinDeg }// sector fold + mirror
  | { kind: 'mobius'; a; b }             // conformal swirl (complex map, precomputable)
  | { kind: 'tile'; cols; rows }         // repeat
  | { kind: 'swirl'; amount; radius }
  | { kind: 'hyper4d'; rotXW; rotYW; rotZW; wSpeed };
```

`hyper4d` is the 3D→4D ask made concrete: lift the pixel's WORLD position to 4D
`(x, y, z, w = f(t))`, rotate in the XW/YW/ZW planes, project back to 3D, and sample the
scene at the projected position — on a static kit this reads as the drum surfaces flowing
through an invisible rotating hypervolume; patterns crawl in a way no 3D motion produces.
It samples world-space (not canvas-uv), so `hyper4d` is defined for `cylinder`/`footprint`
samplers first. Each lens ships with 2–3 gallery presets so day-1 users see the payoff
(e.g. *Tunnel Rings* = stripes + polar, *Hyper Drift* = noise + hyper4d).

### D6. Gallery redesign (DESIGN-SYSTEM + `/make-interfaces-feel-better` + ui-shot)

- **Card:** fake-drum thumbnail (D7) · name · 1-line description (2-line clamp) · tag
  pills (max 3 + overflow) · param-count pill (`6 params`, hover → param names) ·
  deprecated never listed.
- **Filters:** collection tabs (D1) as the primary rail; tag pills as toggleable filter
  chips (AND semantics); search over name+description+tags; a "has parameter" filter
  (dropdown of known param keys — `hue`, `speed`, …) for the param-discoverability ask.
  Scope tabs (drum/kit) remain but demoted to a filter chip.
- **Sections:** canvas scenes and lens presets appear as their own collections with the
  same card anatomy (`canvas`/`lens` engine tags).
- Keep: portal/Dialog structure, staggered entry, selection ring, `pickEffect` flow.

### D7. Fake-drum thumbnails (uniform representation)

Replace the raw 26×13 `fillRect` grid with a **pseudo-3D drum painting** of the SAME
`buildThumbPixelModel` output: project each thumb-pixel's cylindrical position to 2D
(fixed isometric-ish camera: hoops as stacked ellipses, slight vertical perspective), paint
a soft dot per pixel (radius ~2px, additive glow). Same camera, same drum, same
hit-cadence (existing 1600ms loop, seq bump already fixed) for EVERY effect — variance in
thumbnails then means variance in the effect, not in the rendering. Canvas 2D only
(precompute the 338 projected `(x, y, r)` once, per frame just recolour) — no WebGL, cost
comparable to today. Kit-wide effects (`ripple-3d`, `spark-arc`) get a second mini-drum in
the background so cross-drum travel reads. Reduced-motion picks each effect's
"representative age" = 35% of its dominant life param instead of the fixed 400ms.

### D8. What this does NOT change
- `EffectGenerator.render` signature, determinism rules, purity of core, the emission
  contract, the modifier/modulation systems (consumed, not modified), the perf-SLA
  telemetry plan (`docs/plans/perf-sla-telemetry.md` — canvas renders inside the same
  per-effect profiling unit).
- The Rock Solid initiative's scope: this plan COMPOSES with docs 06/10/11; if a Rock Solid
  lane touches `GraphNode` play fields concurrently, sequence B/C slices behind it (check
  the lanes tracker before starting C1).

---

## Decisions (LOCKED with Trent, 2026-07-05 — nothing blocks execution)

| # | Decision | LOCKED answer |
|---|---|---|
| 0 | Scope | **Full plan, all 21 slices** (lean cut offered and declined — "rich library from day 1") |
| 1 | Retired effects | **Hidden-but-aliased forever** (alias map; never hard-delete) |
| 2 | Pattern path | **Retire + DELETE** `pattern-renderer.ts` once its 10 effects are aliased (D2 proceeds) |
| 3 | Canvas authoring day-1 | **Presets + param tweaking** (scene JSON editable in Objects view); visual scene editor = separate later initiative |
| 4 | Merge list | As tabled in D2; B1 audit may adjust details without re-asking |
| 5 | Thumb camera | **Isometric drum** (¾-angle stacked ellipses, glowing dots, background mini-drum for kit-wide effects) |

---

## Slices

Uniform ~15–25 min, one seam each, `pnpm test` + `pnpm typecheck` green per slice; UI
slices additionally design-system + `/make-interfaces-feel-better` + `pnpm ui-shot` against
the running dev server (**:4321/:5173**). Tags: `[mech]` mechanical batch, `[ui]`
ui-significant (strongest tier), `[core]` pure core.

### Phase A — metadata + gallery
- **A1 `[core]`** — `description`/`tags`/`deprecated` on `EffectGenerator` (types.ts) +
  controlled tag vocabulary module + `aliases.ts` (empty map) + registry test that every
  non-deprecated effect HAS description+tags (initially skipped-list, shrinks per batch).
- **A2 `[plumbing]`** — flow metadata core→web: `fixtures.ts` mapping + `EffectDef` fields +
  alias resolution at hydrate/`setShow` (both sim + core show-builder).
- **A3 `[ui]`** — gallery card anatomy: description line, tag pills, param-count pill
  (hover popover with param names/units). ui-shot: card grid.
- **A4 `[ui]`** — fake-drum thumb renderer (projected-dot painter in `EffectThumb`,
  precomputed projection table; both generator + interim pattern paths; background
  mini-drum for `kit-wide`-tagged effects; representative-age reduced-motion). ui-shot:
  gallery + inspector + clip-settings thumbs.
- **A5 `[ui]`** — gallery filters: collection tabs, tag chips (AND), has-param filter,
  search over description/tags, scope demoted to chip. ui-shot: each filter state.
- **A6 `[mech]`** — author descriptions+tags for all KEEP effects (Gen-2 textures,
  particles, bases) in the Gen-3 voice; extract Gen-3 docblocks into `description`.

### Phase B — library rehab (after A1; B2+ after B1)
- **B1** — disposition audit: verify the D2 table per effect against source; write the
  final alias map + merge param unions into this doc (update the table in place).
- **B2 `[mech]`** — emission-lift batch 1: `follow-hoop`, `wipe-3d`, `wave-collapse`,
  `velocity-flames` (+descriptions/tags). Reference: `chase-bands`.
- **B3 `[mech]`** — emission-lift batch 2: `pixel-accum`, `swing`, `sidechain`,
  `sacred-hogs`, `collisions` (+descriptions/tags).
- **B4** — retire + merge: implement D2 merges (param unions, presets preserved), populate
  `aliases.ts`, mark `deprecated`, hydrate-migration test (old show → renders via new ids,
  byte-plausible), gallery hides deprecated.
- **B5 `[core]`** — gap-fill Gen-3 natives (pick 3–4 from: `orbit-comet` kit-orbit,
  `scan-plane` beat-locked 3D plane sweep, `drum-sonar` ping-pong between drums,
  `gravity-drops` bounce off hoops via grid). Each: emissions + description + tags + tests.

### Phase C — play types + canvas engine (C1 after A1; check Rock Solid lane overlap first)
- **C1 `[core]`** — `playType` seam: `GraphNode.playType?/canvas?`, `PlayAction`/`Voice`
  carry-through, compositor third dispatch branch (no-op renderer stub), zod/persistence
  defaults (`hosted`), determinism test at the seam. Web sim mirrors structurally.
- **C2 `[core]`** — canvas engine: `canvas/types.ts` scene model, element renderers
  (stripes/circle/gradient first), `hoop` + `cylinder` samplers, scene→`EffectGenerator`
  adapter, byte-determinism + sampler unit tests.
- **C3 `[core]`** — samplers 2: `strip` + `footprint`; scene-level params
  (rot/offset/scale/samplerRot/speed) exposed via paramSpec (modulation sweep drives them —
  test an LFO on `canvasRotDeg`).
- **C4 `[core]`** — lens chain: `polar`, `unpolar`, `tile`, `swirl`, `kaleido` + chain
  evaluator + tests (stripes+polar == rings golden test).
- **C5 `[core]`** — lenses 2: `log-polar`, `mobius`, `hyper4d` (world-space path) + tests.
- **C6 `[ui]`** — canvas node UI: palette entry / play-node type selector, Inspector scene
  picker + scene param editing, Objects view Canvas Scenes section (JSON-level editing
  day-1 per locked decision 3). ui-shot.
- **C7** — seed preset library: ≥10 canvas scenes (Stripe Band, Tunnel Rings, Checker
  Spin, Kaleido Bloom, Hyper Drift, Strip Rain, …) with descriptions/tags; gallery
  collections for canvas + lens presets. ui-shot: gallery with canvas collection.

### Phase D — polish + verification
- **D1** — thumbnail QA pass across ALL library entries on the fake drum (black/frozen
  audit — telemetry: none should be black at any loop phase); fix stragglers.
- **D2** — pattern-path deletion (post B4, open-decision 2): remove `pattern-renderer.ts`
  path + `Pattern` plumbing, or record why kept.
- **D3** — full ui-shot suite of the gallery states + a live spot-check checklist entry;
  perf: canvas + lens under the 5ms effect budget on the 548px kit (bench like the
  2026-07-05 confetti bench); update `.mex/ROUTER.md` + this tracker to COMPLETE.

### Dependency sketch
```
A1 → A2 → A3 → A5      A1 → C1 → C2 → C3 → C4 → C5 → C6 → C7
A4 (independent after A2)          B1 → B2/B3 (parallel) → B4 → B5
D1–D3 last; B5/C7 feed D1.
```

---

## Status tracker + resume protocol

**Resume protocol:** (1) read this doc top-to-bottom; (2) `git log --oneline -20` and
match commits against the tracker below; (3) trust the tracker only after verifying the
last claimed slice's tests exist and pass; (4) update the tracker row (status + commit)
in the SAME commit as each slice; (5) all decisions are LOCKED (see Decisions table) —
do not re-ask them.

| Slice | Status | Commit | Notes |
|---|---|---|---|
| A1 metadata fields | planned | — | |
| A2 metadata flow | planned | — | |
| A3 gallery cards | planned | — | |
| A4 fake-drum thumbs | planned | — | isometric (locked) |
| A5 gallery filters | planned | — | |
| A6 descriptions (keep set) | planned | — | |
| B1 disposition audit | planned | — | merge list locked as tabled |
| B2 emission-lift 1 | planned | — | |
| B3 emission-lift 2 | planned | — | |
| B4 retire + merge | planned | — | alias-forever (locked) |
| B5 gap-fill natives | planned | — | |
| C1 playType seam | planned | — | Rock Solid merged; no coordination needed |
| C2 canvas engine | planned | — | |
| C3 samplers 2 + params | planned | — | |
| C4 lens chain | planned | — | |
| C5 lenses 2 (hyper4d) | planned | — | |
| C6 canvas UI | planned | — | presets+tweaking (locked) |
| C7 preset library | planned | — | |
| D1 thumb QA | planned | — | |
| D2 pattern-path removal | planned | — | DELETE (locked) |
| D3 verification + close | planned | — | |
