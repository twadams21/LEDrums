# 04 — Section base effects ("looks"): engine parity + authoring UI

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

## Problem

Changing sections fires off base effects, but (a) there's no UI to set/control them, and (b) they
appear in the bus Layers dock but **not** in the visualiser.

## Current state — mechanism fully explained (verified 2026-07-02)

- **Model**: `packages/core/src/voice/types.ts:255-260` — `Section { …, looks: Record<busId,
  effectId|null> }`; `PlayMode = 'oneshot'|'loop'|'hold'` (:10). Buses: 'base'/'trigger'/'effect'
  (`apps/web/src/lib/trigger-lab/fixtures.ts:257-261`). A section's `looks` = which effect loops
  on each bus while that section is active.
- **Web sim implements looks**: `apps/web/src/lib/trigger-lab/sim.ts:777-788` `recallSection` —
  releases non-oneshot voices per bus, spawns each look as a looped voice. Called from
  `store.svelte.ts:1234` on section change.
- **Core engine intentionally does NOT**: `packages/core/src/voice/engine.ts:200-214` — the
  `recallSection` branch only sets `activeSongId`/`activeSectionId` + emits a diagnostic. Verified
  comment at :502-504: *"Section morph from sim.recallSection is intentionally not auto-driven
  yet… Wiring is host work."* Zero engine tests cover look spawning.
- **The discrepancy explained**: LayersDock reads the **local sim's** voices
  (`apps/web/src/lib/app/docks/LayersDock.svelte:38` ← `store.voices`), which contain the looks.
  The visualiser, when connected, renders **server frames**
  (`store.previewFrame = useServer ? serverFrame : frameBuf`, `store.svelte.ts:319-323`) — and the
  server engine never spawned the looks. Offline, both agree (local render includes looks).
- **No authoring surface**: `SectionInspector.svelte` shows name + recall strings only; looks come
  hardcoded from fixtures. Note the **web** section model `SetlistSection { id, name, graphs }`
  (`apps/web/src/lib/app/setlist.ts:15-20`) has **no looks field at all** — looks only exist on
  the core/sim `Section` type; the show-builder bridge decides what the engine sees.

## Proposed design

### 1. Engine parity (core)

Port the sim's recall behavior into `engine.ts` `processEvent` for `recallSection`: per bus,
release non-oneshot voices (existing release path), spawn the section's looks as looped voices via
the existing voice-pool spawn (deterministic — no RNG; state prefix per section+bus so repeated
recalls behave predictably). The sim's `sim.ts:777-788` is the reference implementation; keep both
structurally identical (same order: release then spawn) so offline and connected behavior match.
This closes the visualiser gap at the root rather than patching the view.

### 2. Authored model (web + bridge)

- Add `looks: Record<string /*busId*/, string|null>` to `SetlistSection` (`setlist.ts`), default
  `{}`; persistence coercion + migration in `apps/web/src/lib/trigger-lab/persistence.ts`
  (`coerceAuthored`, pattern at :167-180 `migrateSongs` — idempotent, defensive).
- `show-builder` bridges section looks into the engine `Section.looks` (today it bridges the flat
  graph list into padKey slots; extend the same mapping).
- Store mutation: `setLook(sectionId, busId, effectId|null)` (+ autosave/live-resync ride the
  existing `setShow` re-send, `0b03ed7` pattern).

### 3. UI

- `SectionInspector.svelte`: a "Looks" group — one row per bus (base/trigger/effect… derive from
  `store.buses`), each an effect select (effects list from store; None option). Recalling the
  section while editing gives immediate audible/visible feedback (engine parity makes this true on
  the real kit too).
- LayersDock truth when connected: prefer server voice state (`busLevels` already streams,
  `store.svelte.ts:900`; if per-voice detail is needed, extend the `voice` stats payload) so the
  dock and visualiser can never disagree again. (Shares the "one resolver when connected"
  principle with doc 03.)

## Touch list

- `packages/core/src/voice/engine.ts` (recallSection branch), possibly `voice-pool.ts` (no
  signature change expected)
- `apps/web/src/lib/app/setlist.ts`, `apps/web/src/lib/trigger-lab/persistence.ts`,
  `apps/web/src/lib/trigger-lab/store.svelte.ts` (`setLook`), show-builder bridge
  (`apps/web/src/lib/trigger-lab/` show-builder module)
- `apps/web/src/lib/app/docks/inspectors/SectionInspector.svelte`,
  `apps/web/src/lib/app/docks/LayersDock.svelte`

## Tests

- Core: recall spawns looks (per bus), releases prior non-oneshot voices, oneshots unaffected;
  recall with empty/absent looks is a no-op; repeated recall of same section doesn't stack voices;
  deterministic across runs. (Currently **zero** tests exist here.)
- Web: `setLook` mutation + persistence round-trip + migration (old shows without looks load);
  show-builder bridges looks; sim/engine recall parity test (same fixture → same voice set).

## Dependencies / ordering

- Best landed after doc 03's "server authoritative when connected" gating (otherwise recall can
  double-spawn: sim + engine). If built first, gate the sim's recall spawn on link-closed.
- Doc 05 (color/params) improves what looks *can look like* but is independent.
