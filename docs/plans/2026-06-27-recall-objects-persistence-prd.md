# PRD — Transport recall · generic graphs · server-persisted shows · Objects view (2026-06-27)

> **Process note.** `/codebase-design` → `/to-prd` from the orchestrator's grounded
> audit of `feat/unified-shell` (HEAD `1deb187`, after the CRUD+ContextMenu+Perform
> initiative). Tracker = `docs/*`: PRD in `docs/plans/`, per-slice briefs in
> `docs/prompts/*.md`, live build state in `docs/handoff/2026-06-27-orch-status-2.md`.
> Sign-off captured before writing (server-authoritative shows · effects/presets not
> deletable except unused presets · pad-graph delete is real/silent). **The
> componentisation pass is OUT of this PRD** — it gets its own explore→scope→plan→build
> cycle afterward.

## Problem Statement

As the rig-builder/performer on LEDrums:

- I can't drive the set from my **controller or a DAW**. There's no way to change songs or
  recall sections from MIDI or OSC — the engine has the machinery (`recallSection`,
  `setActiveSong`) but nothing routes a Program Change / CC / OSC message into it. And
  when I select a section I get no settings — not even a rename — and no indication of what
  message would recall it.
- **Graphs feel second-class and inconsistent.** Some graphs (the "authored" ones) can be
  renamed/deleted; others (the pad ones) can't, for no reason I care about. I can't
  duplicate a graph at all. They should all just be graphs.
- **My shows aren't safe.** Clearing browser storage wipes every saved show — they only
  ever lived in localStorage. I have no confidence my work is saved at all: there's no
  indication that a save happened.
- **I have no place to manage my stuff.** Songs, effects, graphs, and presets are scattered
  across the views with no single index where I can browse, rename, duplicate, or tidy them.
- The **view order** doesn't match how I work — performance and object-management should
  lead, authoring should follow.

## Solution

1. **Global MIDI/OSC transport recall.** A DAW/controller drives the set:
   **Program Change → song** (by index in the active setlist), **CC #0 value → section**
   (by index in the active song), **OSC `/ledrums/song_<n>/section <value>`** → both.
   These are global conventions, not per-section bindings — **CC #0 is reserved** (no other
   trigger may bind it) and the OSC is auto-available. Selecting a section shows an
   **Inspector panel**: rename it, and see the **exact MIDI/OSC message** that recalls it.
2. **All graphs are generic.** The authored/pad distinction is gone — every graph can be
   renamed, deleted, and **duplicated** (duplicate added to the context menu). Deleting a
   graph is real; a pad with no matching graph simply stays silent until you give it one.
3. **Shows are safe.** The show library is **persisted on the server** (like the routing
   project) and hydrated on cold load, so clearing browser storage no longer loses shows;
   localStorage becomes a cache. A **`Saving… / Saved` indicator** by the setlist button
   gives live confidence that work is being saved (it animates for ≥150ms even on instant
   saves).
4. **An Objects view.** A new master-detail index: pick a type (Songs · Effects · Graphs ·
   Presets) on the left, browse/edit/rename/duplicate (and delete where allowed) on the
   right.
5. **Views reordered** to **Perform · Objects · Sections · Trigger · Patch.**

## User Stories

**Transport recall (MIDI/OSC)**
1. As a performer, I want a MIDI **Program Change** to switch to that song in my setlist, so my DAW/controller drives the set.
2. As a performer, I want **CC #0** to recall the section at that value's index in the current song, so I can jump sections from a knob/pad.
3. As a performer, I want **OSC `/ledrums/song_<n>/section <value>`** to select song *n* and section *value*, so a show-control system can drive everything with one message.
4. As an author, I want **CC #0 reserved** — no other trigger or param can bind it — so section-recall never collides with a mapped control.
5. As a performer, I want to click a section and **rename it** in the Inspector, so its label matches the moment.
6. As a performer, I want the section Inspector to **show me the exact OSC and MIDI message** that recalls it (read-only), so I know what to send from my rig.
7. As a performer, I want a song's recall message (its Program Change number) visible too, so song-switching is discoverable.

**Generic graphs**
8. As an author, I want **every** graph renamable — no "authored vs pad" distinction — so naming is uniform.
9. As an author, I want to **delete any** graph; if I delete the one a pad used, that pad is simply silent until I give it another (no hidden respawn).
10. As an author, I want to **duplicate** a graph from its context menu, so I can fork a starting point.
11. As an author, I want restored shows to show friendly graph names (e.g. "Kick · center"), not raw keys, so nothing regresses visually.

**Safe shows + save confidence**
12. As a performer, I want my shows to **survive clearing browser storage**, so I never lose work to a cache wipe.
13. As a performer, I want shows to load from the server on a **cold start** (fresh browser), so my library is there on any client.
14. As a performer, I want a **`Saving…` → `Saved`** indicator by the setlist button, so I trust my changes are persisted.
15. As a performer, I want that indicator to **animate visibly** (≥150ms) even when saving is instant, so the feedback reads as real.

**Objects view**
16. As an author, I want an **Objects** view listing types (Songs · Effects · Graphs · Presets), so there's one place to manage everything.
17. As an author, I want to pick a type and see **all objects of that type**, then view/edit/rename/duplicate them.
18. As an author, I want to **delete** songs and graphs freely, **rename/duplicate** effects and presets, and **delete a preset only when nothing uses it** — and I want effects and in-use presets protected from deletion.

**View order**
19. As a user, I want the rail ordered **Perform · Objects · Sections · Trigger · Patch**, so performance and object-management lead.

## Implementation Decisions

**Seam discipline (codebase-design).** Extend existing interfaces; add exactly one new
seam where something genuinely varies.

- **Transport recall = one global handler at the server input boundary.** The engine
  already exposes `recallSection` + active-song/section state; the show model already
  indexes songs/sections. So a single handler in the server input path (before zone-map /
  per-trigger resolution) maps **Program Change → `setActiveSong(index)` + recall that
  song's first section**, **CC #0 value → recall section `index` in the active song**, and
  **OSC `/ledrums/song_<n>/section <v>` → both**, all by converting indices→ids and reusing
  the existing `recallSection` input. New plumbing (the only gap): the browser WebMIDI
  parser handles **Program Change (0xC0)** and **Control Change (0xB0)**, and two WS client
  messages carry them (`{t:'cc',controller,value}`, `{t:'programChange',value}`). **CC #0
  is reserved**: the trigger-source editor forbids binding controller 0. A pure helper
  produces the human-readable recall strings (OSC + MIDI) the Inspector displays.
- **Section Inspector panel.** Selecting a section drives the Inspector (a new selection
  kind alongside the node kinds) to show rename + the read-only recall strings. Reuses the
  existing per-kind Inspector dispatch.
- **Generic graphs = delete one guard.** Drop `isAuthoredGraphKey`; `graphNames` carries a
  display name for **every** graph key (pad labels hydrated on load so restored shows read
  nicely); `renameGraph`/`deleteGraph` operate on any key; add **`duplicateGraph`** (clone
  → fresh key → "… copy", mirroring `duplicateSong`). Hit-resolution is already by trigger
  **source**, so a deleted graph just means no source matches → that pad is silent. No
  regeneration.
- **Server-authoritative shows.** Extend the S7 server-autosave + `state`-adopt pattern
  (already used for the routing `Project`) to the **authored show library**: the server
  owns the library file, autosaves it (debounced, atomic, off the render loop), broadcasts
  it on cold load, and the single-client lock applies. The web store adopts the
  server's library on connect; localStorage is demoted to a fast cache (offline/first
  paint). The routing `Project` stays separate.
- **Save status = one store rune.** A `saveStatus` ('idle' | 'saving' | 'saved') the store
  sets when an autosave is scheduled/flushed, with a **minimum visible duration (≥150ms)**
  so instant saves still animate. A small TopBar indicator beside the setlist button
  consumes it.
- **Objects CRUD backfill (scoped to the sign-off).** Add `duplicateGraph` (above);
  `renameEffect`/`duplicateEffect` (**no `deleteEffect`** — effects are foundational);
  `renamePreset`/`duplicatePreset` and **`deletePreset` only when its usage count is 0**
  (a pure usage helper gates it; in-use presets and all effects are not deletable). Editing
  preset params already exists.
- **Objects view + rail reorder.** A new `objects` member in the `shell-nav` `View` union;
  the rail becomes **Perform · Objects · Sections · Trigger · Patch**. The view is a
  master-detail: a type list (like the Sections-view graph rail) + an object list for the
  selected type, each row wired to the existing CRUD via the ContextMenu primitive.

**Build order / prefactor.** Generic-graphs and the effects/presets CRUD backfill land
first (they enlarge the store surface the Objects view consumes). Server-persisted shows is
the highest-blast-radius slice (persistence + store hydration + server + WS) — it runs
relatively isolated; the save indicator follows it (so it reflects the real save path).
Transport recall (browser+server+inspector) is largely disjoint and parallelizable. The
Objects view + rail reorder lands last (it depends on the CRUD surface + the new nav member).

## Testing Decisions

External-behavior tests through each module's interface; Svelte components verified by
typecheck + svelte-check + the autofixer, with a live `:5173` spot-check owed.

- **Transport recall** — pure index→id mapping + the recall-string helper (Program Change →
  song i; CC0 v → section v; OSC parse of `/ledrums/song_n/section v`; out-of-range
  clamps/no-ops; CC0-reserved rejection in the trigger-source editor). Prior art: the
  U3 `input-router` resolver tests.
- **Generic graphs** — `renameGraph`/`deleteGraph`/`duplicateGraph` work on pad *and*
  authored keys; pad-label hydration populates `graphNames`; deleting leaves no dangling
  section refs; a pad with a deleted graph resolves to silence. Prior art: `store.graphs.test.ts`.
- **Server-persisted shows** — server library autosave + load/migration (reuse S7 patterns);
  the web adopts the server library on `state`; localStorage-cache fallback; no cross-show
  bleed preserved. Prior art: the S7 server persistence tests + `store.shows.test.ts`.
- **Save status** — the rune transitions idle→saving→saved and holds ≥150ms (test the
  min-duration logic as a pure timer, not the DOM).
- **Objects CRUD** — effect rename/duplicate; preset rename/duplicate; `deletePreset`
  gated by a usage-count helper (deletes when 0, refuses when >0); `usageCount` correctness.
- **Objects view / shell-nav** — `VIEWS` includes `objects` in the new order; `parseSearch`
  round-trips `?view=objects`. Prior art: `shell-nav.test.ts`.

## Out of Scope

- **Componentisation pass** — its own later plan (haiku-explore → scope → plan → build).
- **Deleting effects**, and **deleting in-use presets** — explicitly disallowed.
- **Creating presets from scratch** — duplicate-an-existing covers the need; no blank-preset
  builder this round.
- **Renaming "Graphs"** — a naming-exploration doc goes to the vault
  (`~/TWA/Personal/Projects/LEDrums`); no code/identifier rename yet.
- **Buses/drums create-delete**, **per-show routing `Project`**, **cloud/file show storage**
  beyond the server library — unchanged.

## Further Notes

- Built by orchestrated git-worktree impl agents, orchestrator-merged + full-sweep-verified
  per merge — the pattern that ran the prior two initiatives cleanly.
- This touches `packages/core` types + the server (recall handler, show-library
  persistence, WS messages) in addition to the web layer — but honors the non-negotiables:
  `core` stays pure (recall reuses existing engine inputs; no IO in core), all IO behind the
  server/io seams, the render loop untouched (autosave stays off-loop, fire-and-forget).
- A live `:5173` (+ a real MIDI/OSC source, voice mode) spot-check is owed and flagged at the
  end — especially the recall path end-to-end and the server-persisted-show cold-load.
