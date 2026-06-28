# Global MIDI/OSC transport recall

PRD: `docs/plans/2026-06-27-recall-objects-persistence-prd.md`. Branch base
`feat/unified-shell` (worktree — read `docs/prompts/_worktree-note.md`). Wave 1. Mostly
disjoint from the store-heavy slices (browser MIDI + WS protocol + server + a trigger-source
editor touch).

## What this delivers
A DAW/controller drives the set via GLOBAL conventions (not per-section bindings):
- **MIDI Program Change** → select the song at that index in the active setlist (and recall
  that song's **first section** so something plays).
- **MIDI CC #0** (controller 0), value → recall the section at that index in the **active
  song**.
- **OSC `/ledrums/song_<n>/section <value>`** → select song *n* + section *value*.
- **CC #0 is reserved** — the trigger-source editor must forbid binding controller 0.
- A pure helper produces the human-readable recall strings (used by the `section-inspector`
  slice — export it).

## The seam (verified by audit)
The engine already has `recallSection` + active-song/section state and the show indexes
songs/sections — so this is index→id conversion reusing the existing `recallSection` input.
The ONLY plumbing gaps: the browser doesn't parse/forward Program Change (0xC0) or CC
(0xB0), and the WS protocol has no message for them. Add a **single global recall handler**
at the server input boundary, **before** zone-map / per-trigger resolution.

## Scope
- `apps/web/src/lib/midi/webmidi.ts` — parse **Program Change (0xC0)** + **Control Change
  (0xB0)** in `parseMidiMessage`; emit typed events.
- The current MIDI→WS forwarding site (grep for where `{ t: 'midi' }` is sent — likely the
  active store's `initMidi`/`onMidiNote`; NOT the legacy `app-store`) — forward new
  `{ t: 'cc', controller, value }` and `{ t: 'programChange', value }`.
- `apps/server/src/ws-protocol.ts` — add `{ t:'cc'; controller:number; value:number }` and
  `{ t:'programChange'; value:number }` to `ClientMessage` + `CLIENT_TYPES`.
- `apps/server/src/main.ts` (+ `input-router.ts` helpers as needed) — a global recall
  handler that intercepts `programChange` / `cc` (controller 0) / OSC addresses matching
  `/ledrums/song_<n>/section <v>` and converts to `setActiveSong(index)` + `recallSection`
  by id, BEFORE the zone-map path. Index→id via the voice host's current show; clamp/no-op
  out-of-range. CC#0 needs the engine's **active song** to resolve a section index — read it
  from the voice host/engine.
- The **trigger-source editor** (where a trigger node binds a MIDI CC — Inspector / the
  trigger source UI from U2) — **reserve controller 0**: disallow selecting/entering CC 0
  (disable + a hint "CC 0 reserved for section recall").
- `packages/core` — only if a tiny type addition is needed; recall reuses the existing
  `InputEvent`/`recallSection`. Keep core pure.
- A pure **recall-string helper** (e.g. `apps/web/src/lib/app/recall.ts`):
  `oscForSection(songIdx, sectionIdx)` → `/ledrums/song_<n>/section <m>`;
  `midiForSection`/`midiForSong` → readable "Program Change <n>" / "CC 0 value <m>". Exported
  for `section-inspector`.

## Tests
- Pure mapping + helper: PC index→song; CC0 value→section; OSC parse of
  `/ledrums/song_n/section v`; out-of-range clamps/no-ops; recall-string formatting.
- `input-router`/server: the global handler routes PC/CC0/OSC to recall and does NOT fall
  through to zone-map; CC#0 reserved-rejection in the trigger-source editor (component-level
  verified by typecheck where a unit test isn't natural).
- Browser parse: PC/CC parsing in `webmidi.ts`.

## Gate discipline
Per-package typecheck/test; full `pnpm typecheck && pnpm test` on the committed tree.
Touches core/server/io boundaries — keep `packages/core` pure (no IO). **Svelte MCP** for `.svelte`.

## Acceptance
PC switches songs, CC#0 recalls sections, OSC does both, all via the existing engine recall;
CC#0 is unbindable elsewhere; the recall-string helper is exported + tested; full sweep green.
(Live `:5173` + real MIDI/OSC spot-check owed — flag it.)

## Report back
Parent with commit SHA(s), the WS messages added, the recall handler location, the
recall-string helper signature (so `section-inspector` can consume it), gate totals,
deviations. Commit before reporting; ROUTER to orchestrator.
