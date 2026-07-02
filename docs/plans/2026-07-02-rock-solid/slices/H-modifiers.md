# Group H — Modifier nodes

Context: [doc 06 §C](../06-effect-time-thumbnails-modifiers.md) · Parent PRD: #45 · Stories: 29–32

## S28 — Modifier engine core + Trail `modifiers`

**Blocked by:** none.

**What to build:** The modifier registry in core (pure per-modifier apply over a framebuffer
range, param specs, per-voice state slot) and the compositor hook: a voice's resolved modifier
chain applies between generator render and blend (pattern-path voices route through a scratch
buffer only when modified, preserving the zero-alloc hot path). First modifier: Trail/Decay
(temporal smear, per-voice frame state). Voices carry the resolved chain; web sim render mirrors.
Test-verified end-to-end at the engine seam (graph wiring arrives in S29).

**Acceptance criteria:**
- [ ] Trail golden: modified voice output vs baseline; temporal state across ticks; deterministic
- [ ] Bypass = identity; unmodified voices take the unchanged hot path (no scratch alloc)
- [ ] Chain application order respected (multi-modifier fixture)
- [ ] Sim/engine parity

## S29 — Modifier graph layer `modifiers` `ui-significant`

**Blocked by:** S01 (hardened canvas), S28.

**What to build:** Modifier nodes in the trigger graph: new node kind (inert in trigger-flow
eval), edges gain a target-port field (`in`/`mod`), play nodes render a distinct mod input handle,
drop-anywhere hit-test routes by source kind, palette + NodeCard rendering + a modifier inspector
(params, bypass, per-param envelopes), chain resolution from topology at voice spawn (mod→mod
chains explicit; parallel wires ordered by node y-position; one modifier node feeding many play
nodes = shared params, per-voice state). Persistence coercion for the new kind + port field.
End-to-end demo: wire Trail into a play node.

**Acceptance criteria:**
- [ ] Wire a Trail node → play node: effect renders with trail live (offline sim and engine)
- [ ] Chain resolution tests: mod→mod order, parallel y-order, shared-node independence, inert in
      fire flow, port persistence round-trip
- [ ] Connection validation scopes handles (mod wires only from modifier nodes); never throws
- [ ] Applies `/make-interfaces-feel-better` (wire styling distinct from trigger flow)

## S30 — Modifier batch 2 `modifiers`

**Blocked by:** S29.

**What to build:** Bloom/Glow (spatial spread along strip), Sparkle (random decaying glints),
Grain/Noise (animated texture), Strobe/Shutter (rate/duty chop). Registry pattern from S28.

**Acceptance criteria:**
- [ ] Pure apply goldens per modifier; deterministic (seeded noise); bypass = identity
- [ ] Each usable end-to-end from the graph (one wiring test each)

## S31 — Modifier batch 3 `modifiers`

**Blocked by:** S29, S18 (enum params for axis/mode).

**What to build:** Echo (delayed decaying ghosts), Pixelate/Quantize, Mirror (axis enum),
HueShift/Colorize, Saturation/Levels/Invert.

**Acceptance criteria:**
- [ ] Pure apply goldens per modifier; Echo temporal state across ticks
- [ ] Mirror axis enum editable via the S18 Select control

## S32 — Modifier second wave `modifiers` `mechanical`

**Blocked by:** S29.

**What to build:** Slide/Offset, Blur (1D), Posterize/Threshold, Feedback, Kaleidoscope, Freeze,
Flicker/Glitch, Chromatic offset. Same registry pattern; full creative-expression set complete.

**Acceptance criteria:**
- [ ] Pure apply goldens per modifier; determinism; bypass identity
- [ ] Gallery/palette lists the full set with categories
