# Group I — Modulation system

Context: [doc 10](../10-modulation-system.md) · Parent PRD: #45 · Stories: 33–39

## S33 — Modulation core `modulation`

**Blocked by:** S23 (envelope shapes).

**What to build:** The core mapping model (target param, source ref, amount, invert, min/max
range) resolved onto voices at spawn; the compositor param sweep generalizes from env-only to
summed-and-clamped modulation contributions; envelope-source sampling by voice phase (restarts
per hit) using the S23 shapes. Web sim mirrors. Test-verified at the engine seam (graph wiring
arrives in S34).

**Acceptance criteria:**
- [ ] Multi-source sum + clamp, invert, range mapping (engine goldens)
- [ ] Envelope mapping restarts per voice/retrigger; deterministic across runs
- [ ] Legacy env sweep behavior reproducible via an equivalent mapping (parity fixture for S35)

## S34 — Modulation graph layer: Envelope node + param rows `modulation` `ui-significant`

**Blocked by:** S29 (wiring infra), S33.

**What to build:** Envelope node kind (shape edited via the S24 editor component in its
inspector). Target nodes (play AND modifier) carry an initially-empty exposed-params list;
"Add parameter" in the target inspector; each exposed param renders as its own labelled node-face
row with its own input handle scoped to modulation sources; edges use `param:<key>` target ports.
Per-mapping amount/invert/range edited target-side only (one entry per incoming wire, listed
under the param row); removing an exposed param deletes its wires after confirm. End-to-end demo:
envelope → chase brightness, live.

**Acceptance criteria:**
- [ ] Expose a param → row + handle appear; wire an envelope → parameter animates per hit
      (offline sim and engine)
- [ ] Handle scoping enforced (only modulation sources connect; validation never throws)
- [ ] Mapping edits (amount/invert/range) live target-side and persist (round-trip test)
- [ ] One envelope node driving params on two different nodes runs independent phases (test)
- [ ] Applies `/make-interfaces-feel-better`

## S35 — EnvMap migration + removal `modulation` `mechanical`

**Blocked by:** S34.

**What to build:** Hydrate-time idempotent migrator: each play node's legacy per-param envelope
map becomes an envelope node (per distinct shape per graph, positioned near its first target)
with auto-exposed param rows and equivalent mappings; the legacy field is then removed from the
model. No dual mechanism remains.

**Acceptance criteria:**
- [ ] Migration parity: pre-migration env behavior vs post-migration mappings sample-identical
      (uses the S33 parity fixture)
- [ ] Idempotent; old shows load and play unchanged
- [ ] Legacy field gone from types/persistence (compile-verified)

## S36 — LFO node `modulation`

**Blocked by:** S34.

**What to build:** LFO source node: waveforms (sine/tri/saw/square/S&H), rate as free Hz or
musical division (reuse the division vocabulary), phase offset. Deterministic pure function of
time + bpm; continuous — affects all live voices of its targets, including looped/base voices.
Inspector for its settings.

**Acceptance criteria:**
- [ ] LFO determinism (same t/bpm ⇒ same value) per waveform; division sync tracks bpm (goldens)
- [ ] Wired to an exposed param, modulates live voices continuously (engine + sim test)

## S37 — CC-In node `modulation`

**Blocked by:** S34.

**What to build:** CC-In source node: controller number, channel filter, MIDI-learn (reuse the
learn flow; CC 0 remains reserved for section recall and is rejected). Engine holds a CC value
table updated from the queued CC input events (determinism preserved); the mapping reads it per
frame. Inspector for its settings.

**Acceptance criteria:**
- [ ] CC events move mapped params on all live voices (engine test via event queue)
- [ ] Same event log ⇒ same frames (determinism test); CC 0 rejected in the editor
- [ ] Learn binds the next incoming CC

## S38 — Signal previews + param-row ticks `modulation` `ui-significant`

**Blocked by:** S36, S37.

**What to build:** Node-face signal previews: envelope shape sparkline with live phase cursor,
LFO waveform with moving phase, CC live value bar + readout — all via the shared thumbnail ticker
and viewport-visibility machinery (no new rAF loops), reduced-motion aware (static shape, numeric
value). Exposed param rows show a live value tick while the engine runs.

**Acceptance criteria:**
- [ ] All three source kinds preview their signal on the node face; param rows tick live
- [ ] One shared ticker; offscreen nodes don't render (reuse existing machinery)
- [ ] Reduced-motion: static previews, numeric values (policy test)
- [ ] Applies `/make-interfaces-feel-better`
