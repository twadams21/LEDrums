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
- **C. Typed play nodes + canvas** — play nodes become typed by effect category
  (Particles / Waves / Textures / … / Canvas); swapping is scoped to the node's type. The
  **canvas** type (2D scene → sampled through drum-geometry placements +
  coordinate-transform lenses, an upgrade of the existing field path) is the
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
user-facing **collections** derived from tags: `Hits`, `Waves & Ripples`,
`Particles & Air`, `Textures`, `Ambient & Base`, `Meters & Utility`, `Canvas`. This is the
SAME taxonomy as the typed play nodes (D3) — the mapping lives in ONE core vocabulary
module (`PlayType`); an effect belongs to exactly one collection/type (first tag match
wins, ordered).

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

Unit U3 re-audits this table against source before the batch runs; the table is the
default, not gospel.

### D3. Typed play nodes — category-scoped, one taxonomy (LOCKED with Trent 2026-07-05)

Play nodes become **typed by effect category** — the same taxonomy that drives the gallery
collections (D1). One source of truth:

```ts
// packages/core (single vocabulary module):
type PlayType = 'hits' | 'waves' | 'particles' | 'textures' | 'ambient' | 'meters' | 'canvas';
// GraphNode play fields gain:
playType: PlayType;            // migration: inferred from the node's current effectId
canvasScene?: string;          // playType 'canvas' only — authored scene doc id
```

- Every effect belongs to EXACTLY ONE PlayType (derived from its tags, first-match — the
  same mapping as the gallery collections, so gallery and node types can never drift).
- **Swap is scoped:** the EffectGallery opens pre-filtered AND locked to the node's
  `playType` — a Particle node swaps only among particle effects. The palette offers typed
  play nodes (Add → Play ▸ Particles / Waves / Textures / … / Canvas).
- **The engine stays uniform underneath.** All types resolve through the one
  `EffectGenerator` seam and the existing generator bridge — `playType` is authoring-layer
  taxonomy, not an engine fork. `canvas` nodes resolve a scene document (D4) instead of a
  code-registered generator id; the scene engine presents as an `EffectGenerator` adapter,
  so the compositor and bridge are UNTOUCHED (no third dispatch path).
- **Migration:** persisted play nodes without `playType` infer it from `effectId` at
  hydrate (total mapping — every effect has a type); node face shows the type as the icon
  chip sub-label.
- **Deliberately NOT node types:** coordinate transforms (they are lenses inside canvas
  scenes, D5) and engine internals (hosted-vs-canvas is invisible to the user beyond the
  Canvas type existing).

### D4. The canvas engine — an UPGRADE of the existing field path, not a sibling engine
(LOCKED with Trent 2026-07-05: reuse/restructure existing seams freely — better structure wins)

A canvas effect = **a 2D scene document sampled through a placement of the kit's geometry
onto that canvas**. Authored as DATA → new looks without new code. Structurally this is
`effects/field.ts` grown up, not a new engine beside it:

- `UvMode` (cylindrical/planar-*) → the **sampler** set (hoop/strip/cylinder/footprint);
  `field.ts` is refactored INTO the canvas module (API seams may change — existing texture
  callers updated in the same commit).
- `FieldSample` closures → data-driven **scene evaluation** (the 12 Gen-2 textures are
  exactly hardcoded FieldSamples; spiral/tunnel hardcode the polar math the `polar` lens
  generalizes).
- The scene engine presents as an `EffectGenerator` adapter → flows through the EXISTING
  generator bridge and compositor untouched.
- **Payoff (stretch, U6/later):** re-express Gen-2 textures as canvas scene presets and
  delete their bespoke impls — the codebase shrinks per look.

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
- The Rock Solid initiative's scope: this plan COMPOSES with docs 06/10/11 — Rock Solid is
  fully merged to main (confirmed 2026-07-05), so its modifier/modulation infra is live and
  no lane coordination is needed.

---

## Decisions (LOCKED with Trent, 2026-07-05 — nothing blocks execution)

| # | Decision | LOCKED answer |
|---|---|---|
| 0 | Scope | **Full scope** (lean cut offered and declined; later restructured into 7 natural work units, same content — "rich library from day 1") |
| 1 | Retired effects | **Hidden-but-aliased forever** (alias map; never hard-delete) |
| 2 | Pattern path | **Retire + DELETE** `pattern-renderer.ts` once its 10 effects are aliased (D2 proceeds) |
| 3 | Canvas authoring day-1 | **Presets + param tweaking** (scene JSON editable in Objects view); visual scene editor = separate later initiative |
| 4 | Merge list | As tabled in D2; the U3 audit may adjust details without re-asking |
| 5 | Thumb camera | **Isometric drum** (¾-angle stacked ellipses, glowing dots, background mini-drum for kit-wide effects) |
| 6 | Play node model | **Typed play nodes, category-scoped** — one PlayType taxonomy shared with gallery collections; effect swap locked to the node's type; engine uniform underneath (D3) |
| 7 | Canvas engine structure | **Upgrade `field.ts` into the canvas module** (API seams may change; existing textures re-anchored) rather than a sibling engine; no compositor fork (D4) |

---


## Work units (natural-sized — takes as long as it takes)

Restructured 2026-07-05 from 21 uniform slices to 7 natural units at Trent's direction
(uniform slicing was adding boundary-artifact overhead: standalone audit/QA slices,
seam+stub splits). Each unit ends at a semantically complete, gate-green point
(`pnpm test` + `pnpm typecheck`; UI units additionally design-system +
`/make-interfaces-feel-better` + `pnpm ui-shot` against the dev server on :4321/:5173).
Verification is woven into each unit — no standalone QA passes.

### U1 — Effect metadata + gallery redesign
`description`/`tags`/`deprecated` on `EffectGenerator` + controlled tag vocabulary +
`aliases.ts` (consulted at hydrate/`setShow`, sim + show-builder); flow through
`fixtures.ts` → `EffectDef`; gallery cards (description line, tag pills, param-count pill
with hover popover); filters (collection tabs, tag chips AND, has-param filter, search
over name/description/tags, scope demoted to chip); author descriptions+tags for the whole
KEEP set (extract Gen-3 docblocks). Registry test: every non-deprecated effect has
description+tags. ui-shot: card grid + each filter state.

### U2 — Isometric fake-drum thumbnails (parallel with U3/U4 after U1)
Projected-dot painter in `EffectThumb` (precomputed projection table from
`buildThumbPixelModel`, ¾-angle stacked ellipses, soft glowing dots, additive glow);
background mini-drum for `kit-wide`-tagged effects; representative-age reduced-motion
(35% of dominant life param); works for generator + (interim) pattern paths. QA inline:
audit ALL library entries at multiple loop phases — none black, none frozen. ui-shot:
gallery, inspector, clip-settings thumbs.

### U3 — Library rehab, merges, retirement (parallel with U2/U4 after U1)
Audit the D2 disposition table against source (adjust details inline — merge list locked,
no re-asking); emission-lift the hit-driven Gen-0/1 effects (reference: `chase-bands`;
audit kit-fraction reaches → drum-relative); implement merges (param unions, presets
preserved); populate `aliases.ts` + mark `deprecated` (gallery hides them); retire the 10
pattern effects onto generator equivalents and DELETE `pattern-renderer.ts` + `Pattern`
plumbing once nothing references it (locked decision 2). Hydrate-migration test: old show
with retired ids renders via aliases.

### U4 — Canvas engine (core, one continuous build; after U1)
Typed-play-node seam (`GraphNode.playType` + hydrate inference from effectId,
`PlayAction`/`Voice` carry-through; NO compositor fork — the scene engine is an
`EffectGenerator` adapter through the existing bridge) → refactor `field.ts` into the
canvas module (UvMode → samplers; texture callers updated in-commit) → scene model
(`canvas/types.ts`) → element renderers (stripes/circle/gradient/polygon/checker/noise) →
all four samplers (`hoop`, `strip`, `cylinder`, `footprint`) → scene-level params via
`paramSpec` (modulation sweep drives them — test an LFO on `canvasRotDeg`) → full lens
chain (`polar`, `unpolar`, `tile`, `swirl`, `kaleido`, `log-polar`, `mobius`, `hyper4d`
world-space path). Tests throughout: byte-determinism at the compositor seam per playType,
sampler unit tests, stripes+polar==rings golden, lens chain composition. Perf: under the
5ms effect budget on the 548px kit (bench like the 2026-07-05 confetti bench).

### U5 — Typed play nodes UI + Canvas UI (after U4)
Typed palette (Add → Play ▸ type), gallery pre-filtered AND locked to the node's playType,
node-face type chip, Inspector scene picker + scene param editing, Objects
view Canvas Scenes section (JSON-level editing day-1 per locked decision 3), show-doc
persistence for authored scenes. ui-shot: node face, inspector, objects view.

### U6 — Day-1 library fill (after U4; UI parts after U5)
≥10 seed canvas scenes (Stripe Band, Tunnel Rings, Checker Spin, Kaleido Bloom, Hyper
Drift, Strip Rain, …) + 2–3 presets per lens, all with descriptions/tags; gallery
collections for canvas + lens presets; 3–4 gap-fill Gen-3 natives (from: `orbit-comet`,
`scan-plane`, `drum-sonar`, `gravity-drops`) with emissions + tests. ui-shot: gallery
with canvas collection populated.

### U7 — Close-out
Full ui-shot sweep of gallery states; end-to-end spot-check checklist entry (live
`:5173`); confirm perf + determinism gates across the new library; update
`.mex/ROUTER.md` + this tracker to COMPLETE.

### Dependencies
```
U1 → (U2 ∥ U3 ∥ U4) ; U4 → U5 → U6 ; U7 last (U6, U2, U3 feed it)
```

### Model routing (LOCKED with Trent 2026-07-05)
**Fable:** U2 (thumb look = taste), U4 (novel engine + math + determinism), U6 (library
content quality IS the product). **Opus:** U1, U3, U5, U7 (well-specified UI assembly,
mechanical batches, verification).

---

## Status tracker + resume protocol

**Resume protocol:** (1) read this doc top-to-bottom; (2) `git log --oneline -20` and
match commits against the tracker; (3) trust the tracker only after verifying the last
claimed unit's tests exist and pass; (4) update the tracker row (status + commits) in the
SAME commit(s) as the unit lands — for multi-commit units, update `notes` with progress
("samplers done, lenses next") so an interrupted unit is resumable mid-way; (5) all
decisions are LOCKED (see Decisions table) — do not re-ask.

| Unit | Status | Commits | Notes |
|---|---|---|---|
| U1 metadata + gallery | done | 2093a77, 8dce68b, d998e54 | Seam+vocabulary+aliases (2093a77); web flow-through + alias consult points at hydrate/buildShow (8dce68b); gallery redesign (collection tabs, tag chips AND, has-param filter, desc/tag/param pills), new `Pill` primitive + styleguide + regen design-system.html, ui-shot captures (effect-gallery, -collection, -filtered). All 45 non-deprecated effects described+tagged. Pattern effects still listed (untagged) — U3 retires them. |
| U2 isometric thumbs | done | 1d7398f, c81d68c | New `thumb-projection.ts`: fixed ¾-angle camera projects the 338 thumb pixels once per size (stacked ellipses, slight vertical perspective, depth shading, dpr-crisp), painter recolours soft additive glowing dots per frame; baked unlit base layer keeps the drum form readable when an effect is dark. Kit-wide-tagged effects get a background mini drum (same frame, dimmed/smaller). Reduced-motion = representative age (35% of dominant life param: lifeMs/decayMs/…/lifeBeats@500ms, fallback 35% of the 1600ms loop). EffectThumb prop API UNCHANGED (TriggerNode untouched). Gates: typecheck clean; core 586 / web 1184 / server 227 / io 51 green (+10 new projection/rep-age tests). QA: headless audit of all 58 gallery cards at ~36 sampled loop phases (3 passes × scroll sweep) — 0 black, 0 frozen, 0 console errors; ui-shots u2-gallery / u2-inspector-thumb show the isometric drum + mini drum on kit-wide cards. ClipSettings (84×46) has no UI entry point on main (nothing calls `store.openSettings`) — covered by size-parametrised projection tests instead of a live shot. |
| U3 rehab + retirement | done | 11ef0b1, 6d2e589, 2465b90, a5341f3 | (1) Core rehab (11ef0b1): aliases.ts populated (retired generators `gen:chase`/`gen:burst`/`gen:colour-melody` + 10 pattern ids → gen targets); chase/burst/colour-melody `deprecated`; colour-melody merged into whole-drum via `noteHue` bool; burst merged into radial-wash (`Pop` preset). D2 Lift-row audit: the 9 effects already iterate the trigger stream hit-relative (seq-gated / ageMs-driven) and layer — none render one global beat-indexed thing (the chase pathology), so no emitter conversion warranted; reaches are absolute-mm world-space or hoop-index drum-relative (no kit-fraction bug). (2) Retirement (6d2e589): 10 pattern effects removed from the selectable library; seed PADS/SECTIONS + styleguide + web tests remapped to generator ids; migration test added. (3) Physical deletion (this commit, decision: remove EffectCreator per Trent): deleted `voice/pattern-renderer.ts`, the `Pattern` type + `pattern` field (core+web), the compositor/engine `attrs` path, render.ts + EffectThumb pattern branches, and the pattern-authoring EffectCreator + `store.createEffect`/`NewEffectInput`/`buildEffect`. Every effect is now generator-backed; the compositor has ONE render path. Determinism tests reworked pattern→generator voices WITHOUT weakening assertions (breathing-kit = geometry-uniform continuous fill for the compositor scope-mask + hoop-geometry parity; solid-base for continuous modulation; modulation frameSum measures RGB — a generator owns alpha independent of the modulated brightness). **Gates green:** typecheck clean; core 586, web 1174, server 227, io 51; grep proves zero pattern-render refs; gallery ui-shot (no "+"/create button, zero console errors) + node-editor healthy; design-system.html regenerated (EffectCreator pointer gone). NOTE: TriggerNode.svelte (Trent's WIP) — the pattern-path deletion changed EffectThumb's prop API, so U3 updated its EffectThumb call in `playThumb` (dropped `pattern`/`triggered`/`triggerAt`, added `generatorId`/`labModel`) to keep the gate green. Left UNSTAGED. ⚠️ Orch flagged to Trent: this is a 4-prop rewrite (not "one line" as first reported), and pre-existing WIP content can't be verified from git — Trent to confirm his WIP intent survived. |
| U4 canvas engine | done | bf3b1fa, 2ea59d5, e3d5c40, 2f0175f, 60a30cb, +M7 | Full canvas engine in `packages/core/src/canvas/`: (M1) typed-play-node seam — playType/canvasScene through GraphNode→PlayAction→Voice, `canvas:<sceneId>` hosting via the EXISTING generatorId path, `playTypeForEffect` total mapping, web hydrate inference; (M2) field.ts refactored INTO canvas/sampler.ts, 12 UV textures re-anchored in-commit; (M3/M4) scene model + six pure element renderers, painter's-order alpha-over; (M5) four samplers as precomputed per-pixel tables (hoop grid/placements, strip arclength, cylinder region, footprint==planar-xz); (M6) `createCanvasSceneEffect` adapter + scene registry resolved inside `tryGetEffect` — compositor + bridge UNTOUCHED (no fork, locked dec 7); CANVAS_PARAM_SPEC (canvasRotDeg/OffsetX/Y/Scale, samplerRotDeg, speed, brightness, hue) drives via the standard modulation sweep (LFO-on-canvasRotDeg test); (M7) full lens chain polar/unpolar/log-polar/kaleido/mobius/tile/swirl + hyper4d world-space path; goldens: stripes+polar==rings, ordered chain composition; byte-determinism at the compositor seam (canvas + mixed canvas/hosted engine replays); perf 0.54ms/frame on the 548px kit (budget 5ms). Gates: typecheck clean; core 625 / web 1187 / server 227 / io 51. Scene presets + registry hookup for authored scenes → U5/U6. |
| U5 canvas UI | planned | — | presets+tweaking locked |
| U6 library fill | planned | — | |
| U7 close-out | planned | — | |
