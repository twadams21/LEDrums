# Group B — IO confidence surfaces

Context: [doc 01](../01-io-confidence-pixlite.md) (§ current state + confidence UI) · Parent PRD: #45 · Stories: 1–2, 9–10

## S02 — OutputPill truth from OutputStatus `ui-light` `plumbing`

**Blocked by:** none.

**What to build:** The engine-link pill derives from the `OutputStatus` already broadcast in every
`stats` message (state armed/dry-run/disabled, packetsSent, lastError), not just WS link state.
Pure derivation function (link, OutputStatus) → tone/label/title; error tone + tooltip when
`lastError` set; dry-run and disabled shown honestly.

**Acceptance criteria:**
- [ ] Pill shows distinct states: live+transmitting, armed-but-erroring (error tone + last error in
      tooltip), dry-run, disabled, link-closed
- [ ] Table-driven unit tests over the pure derivation
- [ ] "LIVE" is impossible while `lastError` is set or packets aren't flowing

## S03 — Output status panel `ui-significant`

**Blocked by:** none (S48 later embeds controller stats into this panel).

**What to build:** A status section in the Patch controller inspector showing output state,
packets/s (derived from cumulative packetsSent between stats ticks), universe count, target
host:port/protocol, and last error. This is the confidence home that PixLite data later extends.

**Acceptance criteria:**
- [ ] Panel renders live from `stats` messages; error prominently styled
- [ ] Packets/s derivation unit-tested (pure)
- [ ] Applies `/make-interfaces-feel-better`

## S04 — Input activity badges `ui-light`

**Blocked by:** none.

**What to build:** A "last heard" indicator beside every MIDI/OSC binding (trigger-source
inspector + patch zone inspector): matched note/address, value, and age (e.g. "C4 · 92 · 2s").
Fed by the existing input/monitor WS traffic through a pure matcher (binding × event → badge
state). After MIDI-learn binds, the badge confirms the note is subsequently heard.

**Acceptance criteria:**
- [ ] Badge appears on both inspectors, updates on matching input, ages out visually
- [ ] Pure matcher unit-tested (note/channel filters, OSC address match)
- [ ] No badge churn from non-matching traffic

## S05 — MIDI device list in settings `ui-light`

**Blocked by:** none.

**What to build:** The app settings dialog lists connected WebMIDI input devices (name, state)
with hot-plug refresh, sourced from the existing WebMIDI init's device enumeration.

**Acceptance criteria:**
- [ ] Devices listed; plugging/unplugging updates the list without reload
- [ ] Empty state explains browser permission if WebMIDI unavailable
