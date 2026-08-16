# S8 — Per-trigger MIDI velocity sensitivity curve (Settings, live feedback)

**Effort: opus/high (cross-host input seam + the live-feedback UX) · branch
`feat/velocity-sensitivity` off S6a's branch tip (consumes `CurveField`) · PR into main
(stacks above S6a).** Requested by Trent 2026-08-17 (verbatim): customise the sensitivity of
the MIDI velocity input of the drum triggers, **per trigger not per zone** — "Kick has 1
sensitivity curve, not each zone of the kick drum" — in the Settings menu near the drum
trigger zones, using the envelope-style control, with **live feedback in the envelope when
triggered "so that we can see how much the changes are fixing / helping"**.

## Model (decided by the orchestrator; escalate only if the code contradicts its premises)

- **Storage**: an optional per-drum transfer curve in the input model (core `InputMap`, beside
  the per-drum zone/trigger config — verify the exact home; per-DRUM, keyed like the drum
  trigger identity Settings already edits, NOT per zone/slot). Value = S6a's `CurveValue`
  with transfer-curve semantics: x = normalised input velocity 0..1, y = normalised output
  velocity 0..1. Absent = identity (today's behaviour, exactly).
- **Application point**: ONE pure core function `applyVelocityCurve(curve, velocity)` (reuse
  S6a's curve-eval maths), called at the velocity-normalisation seam on EVERY path that turns
  a hit into a fire: server MIDI ingest, browser WebMIDI forward, offline/local fires
  (keyboard + offline hardware MIDI). **Mutation parity** (`/mutation-parity`): find the
  single choke point where raw velocity becomes the engine's velocity; if there are several,
  route them through one shared helper rather than patching each.
- **Mutations**: edited through the same validated `setInputMap` gate the zones use (G4 put
  OSC-learn through it — same discipline). Same undo/broadcast path. Protocol schema extended
  with the optional field; compile-time locks updated.
- **Live feedback**: the Settings pane feeds `CurveField`'s live-input overlay with recent
  hits for THAT drum: input velocity + curve-mapped output. Source: the existing monitor bus
  input/fire events if they carry velocity (verify — G1's fire indicator consumed a per-fire
  `graph` monitor event; there may be an input-stage event with velocity). If velocity is
  missing from the monitored event, ADD it to the existing event payload (schema + lock)
  rather than inventing a new message. Overlay must show pre-curve input mapped through the
  CURRENT edit state (unsaved tweaks reflect immediately) — that is the whole point.

## UI

In Settings › the drum trigger zones neighbourhood (the G4-era Input/zones panes): one
`CurveField` per drum, presented per the section's card language (G3 recipes, stacked-label
grids). Identity curve renders as a subtle diagonal. Reset-to-identity affordance. ⓘ copy per
G4's placeholder/ⓘ convention. Apply `/make-interfaces-feel-better`.

## Anchors to verify

- Core `InputMap` shape + `setInputMap` gate + its zod schema/locks (S4a kept `label` model
  data; zones are free-named/uncapped since G4).
- Every velocity path: server MIDI ingest, WebMIDI→WS forward, keyboard/local fire, offline
  hardware MIDI (G1 fixed its fire-marking — it exists as a distinct path).
- Monitor bus event payloads for velocity.
- S6a's `CurveField` overlay API + transfer-curve config.

## Scope fence

May touch: core InputMap + curve application + tests, protocol schema/locks, server ingest
seam, web input paths + the Settings pane + ui-shot presets, styleguide only via S6a's
existing entry. Non-goals: zone model changes, trigger detection/thresholds, S6b's
lifeEnvelope, per-zone anything.

## Evidence

- Typecheck 0 + targeted vitest (core curve application per path, protocol, the pane),
  committed HEAD pushed. **Do NOT run the full `pnpm test` sweep — orchestrator-only rule;
  the orchestrator sweeps at review.**
- Core tests: identity when absent; curve applied on each path's helper (server + local
  paths both covered — parity proven by shared-function tests plus one per-path wiring test);
  clamping at 0/1; snap profile step.
- ui-shot: Settings pane with a non-identity curve; if the seam ops can inject a fire with
  velocity, capture the overlay marker — `--strict`.
- Report: commit body <30 lines; one-line completion message with sha + branch.

## Escalate if

- Velocity normalisation has NO single seam and unifying it would touch trigger-detection
  logic (report the path map, wait).
- The monitor bus cannot carry velocity without a new message type.
- Per-drum identity is ambiguous against the zone model (e.g. zones spanning drums).
