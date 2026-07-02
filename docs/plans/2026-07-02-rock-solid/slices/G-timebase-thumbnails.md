# Group G — Effect timebase & thumbnails

Context: [doc 06 §A/§B](../06-effect-time-thumbnails-modifiers.md) · Parent PRD: #45 · Stories: 26–28

## S25 — Timebase infra + chase tracer `effects`

**Blocked by:** none.

**What to build:** Effect generators declare `timebase: voice | absolute` in the registry. The
generator bridge feeds voice-timebase generators hit-relative time (and a voice-local beat derived
from age×bpm) in place of absolute engine time — no generator signature change. Mono voice steal
resets birth time so fast retriggers restart. Convert chase as the tracer (starts at hoop 0 on
the hit, restarts on retrigger). Web render bridge mirrors identically.

**Acceptance criteria:**
- [ ] Chase starts from its start position on fire and restarts on retrigger (engine goldens at
      ages 0/200/800, identical across runs and retriggers)
- [ ] Mono steal resets voice age (test)
- [ ] Absolute-timebase effects unchanged (golden parity)
- [ ] Sim/engine parity for the converted effect

## S26 — Timebase conversion batch `effects` `mechanical`

**Blocked by:** S25.

**What to build:** Convert the remaining free-running trigger-category effects to voice timebase
(synced-hoops, strobe, starfield, collisions, sacred-hogs, gravity-wells, orbit-rings,
comet-trails, temp-sweep, and the texture effects when trigger-hosted), auditing each stateful one
(per-voice state must reset with the voice). Base/ambient effects (breathing-kit, hue-rotate-kit,
solid-base) explicitly stay absolute. Deliver the per-effect timebase audit table.

**Acceptance criteria:**
- [ ] Every converted effect restarts on retrigger (goldens); stateful effects don't leak state
      across voices
- [ ] Base effects still free-run (looks don't phase-snap on section recall)
- [ ] Audit table covers all 41 effects

## S27 — Thumbnail fidelity `effects`

**Blocked by:** S25.

**What to build:** The thumbnail renderer drives its synthetic trigger with a looping age (and a
transport beat advanced from the same clock) so hit-relative effects visibly fire-decay-repeat;
timebase-aware (absolute effects keep wall-clock); reduced-motion keeps the representative static
frame. Audit all 41 thumbs after landing.

**Acceptance criteria:**
- [ ] Hit-relative effects (whole-drum, burst, radial-wash…) animate a fire/decay cycle instead of
      freezing at full brightness (pure render test at looping ages)
- [ ] Absolute effects animate as before; reduced-motion static frame preserved
- [ ] Visual audit note listing any remaining broken thumbs (with cause)
