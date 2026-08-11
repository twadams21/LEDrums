# Global control bindings — MIDI/OSC next/prev song & section in Settings

## Boot sequence — do this FIRST, before any work

You are being launched past the 70% usage soft budget (Trent's explicit call). Your first and
ONLY action this turn: arm your own reset wake by running, in the background,
`twux wake --at reset "usage window has reset — begin the mission"` — then STOP. Do not read
the codebase, do not run pnpm install, do not begin the mission. Wait idle until that wake
prompt arrives (resets 04:50), then start work from the top of this doc. Trent drives from
there.

**Source:** Trent, in conversation 2026-08-12 (this is a stated requirement, not an inference).
**Who drives:** Trent drives this session interactively. You have no orchestrator to report to —
ask Trent directly in-session when a decision below needs his call. Do not message other sessions.

## Mission

Add app-general MIDI & OSC bindings for global control actions, configured in the **Settings
modal**. Each action gets a MIDI binding and an OSC address binding, each with a **text input
and a Learn button**. These live in Settings (not on songs/sections) because they are
independent of any song or section — app-general input routing, like the MIDI channel filter
already there.

## Scope fence — the ten controls (all IN, per Trent 2026-08-12)

Shape the model and the Settings section as a **list of app-general control bindings** — ten
actions now, more later. Build the four navigation actions first (they prove the whole
pipeline), then the rest in the order below.

1. **Next song** · 2. **Previous song** · 3. **Next section** · 4. **Previous section** —
   MIDI note + OSC address each. Design detail in "Design pointers" below.
5. **Panic blackout** — output goes black instantly; the engine keeps running underneath so
   recovery is instant, not a re-cue. Both flavors: **momentary** (dark while the note is held —
   needs noteOff handling, which currently has no engine effect for triggers) and **latched**
   (toggle). OSC: nonzero = on, zero = off. Implement as a deterministic engine-level output
   gate (a flag set via InputEvent, applied at the output stage), never by pausing the engine.
6. **Stop all voices** — the softer panic: releases every running trigger effect without going
   dark; base layers keep rendering. The voice pool already has release machinery — this is a
   new InputEvent, not new lifecycle code.
7. **Master brightness** — the one **CC-bound** control (CC number + OSC address, both
   continuous 0..1): a global output-stage dimmer multiplying the frame. The CC value table
   already exists engine-side; the reserved-CC-0 guard applies to the binding editor.
8. **Global sequence re-sync** — snap EVERY sequencer to step 1 at once (song-restart moment):
   clear the engine's whole seqIndex state, exactly like setShow's clear but state-only.
   (Independent of unmerged PR #168's per-node reset — no interaction on this branch.)
9. **Tap tempo** — MIDI note; 3+ taps set the bpm from the tap intervals (bpm drives
   beat-synced delays and LFOs). **Most uncertain seam: investigate where bpm is authoritative
   (server transport vs engine) before designing — ask Trent if it's ambiguous.**
10. **Transmit toggle** — Art-Net/sACN output on/off (rehearsal mute). A host-level gate on the
    output adapters; the engine keeps rendering. Distinct from blackout: blackout SENDS black,
    this stops sending.

Sequencing advice: land 1–4 as a coherent first PR-sized commit chain (model + resolution +
UI + learn proven end to end), then 5–10 ride the same binding-list model. If usage or time
runs short, 1–4 shipped beats 10 half-done — tell Trent where you stopped.

## Design pointers (verified against main @ 9f60525)

**Model.** The server-authoritative `Project.inputMap` is the home — it already carries
`midiNotes` / `oscMap` / `midiChannel` (zod schema: `packages/core/src/model/project-schema.ts`
~L96). Extend it with a global-controls block (e.g. per-action `{ midiNote?: number;
oscAddress?: string }`). Edits flow through the existing `store.setInputMap` → WS `setInputMap`
path — one mutation path, keep it that way (mutation parity).

**Server resolution.** `apps/server/src/input-router.ts` already runs a step-0 global recall
layer BEFORE the per-trigger zone map (Program Change → song, CC #0 value → section, OSC
`/ledrums/song_<n>/section`). The new bindings resolve in that same layer. For relative
navigation the engine owns the active song/section, so prefer a new deterministic InputEvent
(e.g. a relative-recall event carrying axis + delta) reusing the existing `recallSection`
machinery — core stays pure, no IO imports (AGENTS non-negotiables).

**Decisions with defaults — confirm with Trent as you go:**
- *Precedence:* a note/address bound to a global control is **consumed** — it must not also fire
  a pad/zone or trigger-source graph (mirrors the CC #0 reservation). Surface a hint in the UI
  when a bound note collides with an existing zone mapping (`drumLinkHint` pattern).
- *Ends:* **clamp** at first/last song/section, no wrap-around. **LOCKED with Trent 2026-08-12**
  — a stray extra tap during a set must never teleport the rig back to song 1.
- *CC bindings:* **LOCKED with Trent 2026-08-12** — master brightness (control 7) is the ONE
  CC-bound control (CC number + OSC address, both continuous 0..1); the other nine are notes +
  OSC only. (This supersedes the original "CC out of scope" line, which predated the scope
  growth to ten controls and contradicted control 7.)

**Learn.**
- MIDI learn exists: `MidiLearnTarget` union + host seam in
  `apps/web/src/lib/trigger-lab/midi-controller.svelte.ts`, applied from `forwardMidi` and the
  server input echo. Add a variant for these settings, bound through a store mutator so it
  shares viewer/undo guards.
- **OSC learn exists nowhere in the app yet — you are building the first one.** The seam is
  ready: `store.receiveInputEcho` already records OSC address activity (`recordInputActivity`)
  and feeds `sim.setOsc`. Arm a target, bind the next heard address, disarm. Keep it symmetric
  with the MIDI learn UX.

**Settings UI.** `apps/web/src/lib/app/chrome/AppSettingsDialog.svelte` (the MIDI channel
filter + device list live there). Compose from the design system (`docs/design-system.html`,
regenerate with `pnpm design-system` only if you add something reusable): `Field`,
`CommitInput` (use `formatMidiNote`/`parseMidiNote` from `lib/midi/midi-note`), and the
existing Learn-button pattern (see `TriggerSourceInspector.svelte` — the same 15-line markup +
`.learn` CSS is the house pattern). `InputActivityBadge` gives last-heard confirmation.

## Known future conflict (do nothing now)

Unmerged PR #168 (`feat/sequence-reset-source`) also appends a `MidiLearnTarget` variant and a
branch in `apps/server/src/voice-engine-host.ts`'s diagnostics tail. Trent wants THIS branch off
live main, not stacked — expect trivial additive merge conflicts later; that's accepted.

## Environment

- You are in a twux pool worktree (`~/.twux/worktrees/globalctl`), branch
  `feat/global-control-bindings` off live `origin/main`. Run `pnpm install` before anything —
  fresh worktree, no node_modules.
- Dev port: `TWUX_DEV_PORT=4329` is exported. For UI verification pin
  `UI_SHOT_BASE=http://localhost:4329` (ui-shot probes :5173 by default and can hit a sibling's
  server).
- Push 403s from the wrong gh account are a known trap. Push with:
  `git -c "credential.helper=!f() { echo username=twadams21; echo password=$(gh auth token -u twadams21); }; f" push -u origin feat/global-control-bindings`

## Done bar

AGENTS.md governs (read `.mex/ROUTER.md` first, as it mandates). Green `pnpm typecheck` +
`pnpm test`; UI states captured with `pnpm ui-shot` (all binding states + a learn-armed state);
`/make-interfaces-feel-better` pass on the Settings section; committed AND pushed — a report is
a claim, git is reality. Land through a PR into `main` per the shipping flow; Trent decides
when to open/merge it.
