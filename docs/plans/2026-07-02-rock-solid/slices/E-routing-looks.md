# Group E — Input routing & section looks

Context: [doc 03](../03-input-routing.md), [doc 04](../04-sections-base-effects.md) · Parent PRD: #45 · Stories: 11, 16–21

## S12 — Kill echo re-fire + offline-gated sim `plumbing`

**Blocked by:** none.

**What to build:** The web input-echo handler stops firing the local sim (keeps MIDI-learn and
monitor display). Outbound paths (MIDI forward, pad hit, section-graph fire) fire the local sim
only when the engine link is closed; when connected, the server is the only resolver and clients
display its frames/levels. This is the authority principle every later slice assumes.

**Acceptance criteria:**
- [ ] One connected MIDI hit ⇒ exactly one authoritative fire; monitor shows one input broadcast
      and one graph-fired per resolved graph (count-asserted server test)
- [ ] Echo never fires the sim (web regression test); MIDI-learn still works from echoed input
- [ ] Offline: local firing works as today (preview parity test)

## S13 — Keyboard fireGraph intent message `plumbing`

**Blocked by:** S12.

**What to build:** A new client→server fire-graph message (graph key + velocity). Keyboard
triggering sends it instead of synthetic MIDI/OSC; the server fires that graph directly (no
re-resolution, no echo mis-fire). Offline keyboard still fires the sim.

**Acceptance criteria:**
- [ ] Keyboard on a MIDI-bound section graph ⇒ exactly one fire (the old triple-fire case)
- [ ] Server handler validates the key and emits normal graph diagnostics
- [ ] Protocol change covered by handler tests with fakes

## S14 — Drum-link indicator + unrouted-input event `ui-light`

**Blocked by:** S12.

**What to build:** Pure helper resolving whether a trigger source is also zone-mapped
(→ drum/zone); trigger node face shows a small link icon with a hover tooltip naming it; the
source and zone inspectors show the matching hint in both directions. Engine emits an
unrouted-input diagnostic when a message matches nothing, surfaced in the Monitor.

**Acceptance criteria:**
- [ ] Icon + tooltip appear exactly when a source is zone-mapped (pure helper unit tests)
- [ ] Both inspectors show the cross-reference hint
- [ ] Unmatched note/address produces a Monitor event

## S15 — Engine section looks: spawn/release `plumbing`

**Blocked by:** S12 (prevents double-spawn with the sim).

**What to build:** The core engine implements look spawn/release on section recall, structurally
mirroring the sim's reference behavior (per bus: release non-oneshot voices, spawn the section's
looks as looped voices; deterministic state prefixes). Bridges existing looks data so connected
visualiser output finally matches.

**Acceptance criteria:**
- [ ] Recall spawns looks per bus and releases prior non-oneshot voices; oneshots unaffected;
      repeated recall doesn't stack; empty looks = no-op (currently zero tests exist here)
- [ ] Sim/engine parity: same fixture recall ⇒ same voice set
- [ ] Deterministic across runs

## S16 — Looks authoring UI + model `ui-significant`

**Blocked by:** S15.

**What to build:** The authored section model gains a per-bus looks map (persistence coercion +
idempotent migration; show-builder bridges it to the engine). Section inspector gains a "Looks"
group: one effect picker per bus with a None option; a store mutation persists and live-resyncs.

**Acceptance criteria:**
- [ ] Pick a look → recall the section → it plays on engine and visualiser
- [ ] Old shows (no looks field) load unchanged (migration test); round-trip persistence test
- [ ] Applies `/make-interfaces-feel-better`

## S17 — LayersDock server truth `ui-light`

**Blocked by:** S12.

**What to build:** When connected, the Layers/Buses dock derives from server-streamed voice/bus
state instead of local sim voices (extend the stats voice payload if per-voice detail is needed);
offline it reads the sim as today. Dock and visualiser can no longer disagree.

**Acceptance criteria:**
- [ ] Connected: a server-spawned look appears in the dock without any local sim voice
- [ ] Offline behavior unchanged
- [ ] Source-selection logic pure + unit-tested
