# Effect timebase audit — restart-on-trigger

> Implementation appendix for doc [06 §A](../../plans/2026-07-02-rock-solid/06-effect-time-thumbnails-modifiers.md)
> (Group G). **Infra + tracer by S25** (chase); **conversion batch by S26**. Every one of the
> 41 registry effects is accounted for below. The classification here is pinned to the code by
> an executable test (`compositor.test.ts › … registry timebase classification matches the S26
> audit`) so the two cannot drift.

## The contract (from doc 06 §A / the S25 recipe)

Each effect declares `timebase: 'voice' | 'absolute'` (default `'absolute'`) on its registry
entry (`EffectGenerator.timebase`). The **only** two consumers are the generator bridges — core
`generator-bridge.ts:115` and web `render.ts:221` — which read the flag identically:

- **`voice`** — the bridge swaps the clock the generator reads to a **hit-relative** one:
  `ctx.timeMs = trig.ageMs`, and a voice-local `ctx.transport` whose `beat = age×bpm/60000`. The
  effect starts from its origin phase on the hit and **restarts on retrigger** (a retrigger is a
  new voice whose age is 0). `ctx.dt` stays the real frame delta in both cases.
- **`absolute`** — the engine wall-clock + transport, exactly as before → base/ambient loops
  free-run and never **phase-snap on section recall**.

An effect is "voice" if its animation is hit-relative — whether the bridge swaps its clock
(reads `ctx.timeMs`/`ctx.transport`) **or** it already reads `trig.ageMs` directly (doc 06 §A
defines voice as *"animate from `trig.ageMs`"*). Effects that read neither a clock nor age —
only `trig.seq` (one-shot per hit) + `ctx.dt` — are hit-driven by construction; the flag is
immaterial to them (they still restart, via per-voice `genState` reset).

Legend — **Time source**: what the render reads to animate. **Edit**: was a generator body
change needed (vs. flag-only)? **∅** = no.

---

## VOICE — Tier 1: runtime conversions (this slice, S26) ✅

The nine free-running effects named in the S26 spec. Each reads `ctx.timeMs` or
`ctx.transport.beat`, so declaring `timebase:'voice'` makes the bridge feed it a hit-relative
clock — **flag only, no body edit**. Stateful ones were audited: per-voice `genState` is already
reset on (re)spawn (`voice-pool.ts:110/119`), so seeds/accumulators restart from t=0 and never
leak across voices.

| Effect | id | Cat | Time source | Edit | Notes |
|---|---|---|---|---|---|
| Synced Hoops | `synced-hoops` | base | `ctx.transport.beat` | ∅ | Category `base` but **spec-directed to voice** (doc 06 §A); NOT in the enumerated stay-absolute set. Wave starts from its origin on the hit. |
| Strobe | `strobe` | utility | `ctx.timeMs` | ∅ | On/off phase → hit starts the strobe **on** (age 0 = first half-period). |
| Starfield | `starfield` | particle | `ctx.timeMs` | ∅ | Stateful (seeded star layout). Twinkle phase restarts; layout replays identically per voice. |
| Collisions | `collisions` | wash | `ctx.timeMs` (node angles) + `ctx.dt` (flash decay) | ∅ | Stateful. Nodes start at their seeded phase; flash decay accumulates on real `dt` into reset-on-spawn state. |
| Sacred HOGs | `sacred-hogs` | wash | `ctx.timeMs` (hog angle) + `ctx.dt` (sparkle) | ∅ | Stateful (seeded RNG + sparkle buffer). Hogs start at angle 0; sparkle replays from a fresh seed per voice. |
| Gravity Wells | `gravity-wells` | wash | `ctx.timeMs` (drift) | ∅ | Stateful (seeded wells + captured kit bounds). Drift restarts from the seeded phase. |
| Orbit Rings | `orbit-rings` | wash | `ctx.timeMs` (plane height) | ∅ | Plane sits at the kit centre (sin 0) on the hit. |
| Comet Trails | `comet-trails` | particle | **`ctx.dt` only** (orbit accumulation) | ∅ | Stateful. Reads **no clock** — restart comes purely from `genState` reset (comets re-seeded), not the clock swap. Still flagged `voice` (named batch + restart-on-trigger + S27 contract). |
| Temperature Sweep | `temp-sweep` | wash | `ctx.timeMs` (sweep) | ∅ | Thermal wave restarts from its origin phase. |

Evidence: `compositor.test.ts › voice timebase conversion batch (S26)` — per effect: restarts
on retrigger (retriggered mono voice byte-matches a fresh voice at ages 200 & 800), animates on
the voice clock (not frozen) + lights pixels, and (clock-reading subset) birth-time dependent at
a fixed engine time. Plus stateful no-leak (collisions / sacred-hogs / comet-trails) and
determinism. Web parity: `generator-bridge.test.ts (S26)` — temp-sweep reads the hit-relative
clock (same voice age → identical frame regardless of the absolute transport at firing).

## VOICE — Tier 2: intrinsic age-readers (byte-parity declarations) ✅

These already animate purely from `trig.ageMs` (± `trig.seq`), so they are hit-relative by
construction and restart on retrigger **without any clock swap**. Declaring `timebase:'voice'` is
**byte-parity** (they read neither `ctx.timeMs` nor `ctx.transport` — the full suite stays green)
and makes `gen.timebase` the complete source of truth for "which effects are hit-relative" — the
contract S27's thumbnail renderer reads to drive them with a looping age instead of a frozen
age-0 frame.

| Effect | id | Cat | Time source | Edit | Notes |
|---|---|---|---|---|---|
| Chase | `chase` | trigger | `ctx.transport.beat` | ∅ | Landed in **S25** (the tracer). |
| 3D Radial Wash | `radial-wash` | wash | `trig.ageMs` | ∅ | Doc 06 §A reference "already feels right". |
| Wave Collapse | `wave-collapse` | wash | `trig.ageMs` | ∅ | Shell radius + fade are pure functions of age. |
| Whole Drum | `whole-drum` | trigger | `trig.ageMs` | ∅ | Velocity-scaled decay from the hit. |
| Whole Kit | `whole-kit` | trigger | `trig.ageMs` | ∅ | As whole-drum, kit-wide. |
| Follow Hoop | `follow-hoop` | trigger | `trig.ageMs` | ∅ | Per-hoop cascade from age. |
| Burst | `burst` | trigger | `trig.ageMs` | ∅ | Velocity-scaled decay length. |
| Lightning | `lightning` | particle | `trig.ageMs` + `trig.seq` | ∅ | Bolt seeded per-hit; envelope fades on age. |

Evidence: the pre-existing effect goldens (`effects.test.ts`, `batch-*.test.ts`) stay green →
byte-parity confirmed; the S26 executable-audit test asserts each flag is `voice`.

---

## ABSOLUTE — base / ambient (must free-run) ✅

The enumerated stay-absolute set. They read `ctx.timeMs` and must NOT phase-snap on section
recall. **No flag added.**

| Effect | id | Cat | Time source | Notes |
|---|---|---|---|---|
| Breathing Kit | `breathing-kit` | base | `ctx.timeMs` | Slow kit-wide breath. |
| Hue Rotate Kit | `hue-rotate-kit` | base | `ctx.timeMs` | Free-running hue cycle. |
| Solid Base | `solid-base` | base | `ctx.timeMs` | Free-running noise wash. |

## ABSOLUTE — textures used as looks ✅

All 12 read `ctx.timeMs` **indirectly** through `renderUvField` (`field.ts:43`). The timebase
flag is a **single per-effect** value, so a texture cannot be voice-when-trigger-hosted **and**
absolute-when-a-look. Their dominant role is base/ambient looks, and the hard constraint (looks
must not phase-snap on recall) wins → they **stay absolute** (S25 recipe pt 3: *"Do NOT add the
flag to textures used as looks"*). See **Decisions** below.

| Effect | id | Cat | Time source | Effect | id | Cat | Time source |
|---|---|---|---|---|---|---|---|
| Plasma | `plasma` | texture | `renderUvField`→`ctx.timeMs` | Perlin Clouds | `perlin-clouds` | texture | `renderUvField`→`ctx.timeMs` |
| Fire | `fire` | texture | `renderUvField`→`ctx.timeMs` | Lava Lamp | `lava-lamp` | texture | `renderUvField`→`ctx.timeMs` |
| Ripple Pond | `ripple-pond` | texture | `renderUvField`→`ctx.timeMs` | Interference | `interference` | texture | `renderUvField`→`ctx.timeMs` |
| Rainbow Flow | `rainbow-flow` | texture | `renderUvField`→`ctx.timeMs` | Caustics | `caustics` | texture | `renderUvField`→`ctx.timeMs` |
| Tunnel | `tunnel` | texture | `renderUvField`→`ctx.timeMs` | Spiral | `spiral` | texture | `renderUvField`→`ctx.timeMs` |
| Checker Pulse | `checker-pulse` | texture | `renderUvField`→`ctx.timeMs` | Grid Glow | `grid-glow` | texture | `renderUvField`→`ctx.timeMs` |

## ABSOLUTE — free-running washes not in the named set + hybrid ✅

| Effect | id | Cat | Time source | Notes |
|---|---|---|---|---|
| Helix | `helix` | wash | `ctx.timeMs` | Free-running spiral. **Not in the S26 named set** → left absolute (scope discipline); candidate for a follow-up (behaves like pre-fix chase when trigger-hosted). |
| 3D Wipe | `wipe-3d` | wash | `ctx.timeMs` | Free-running plane sweep. **Not named** — note the asymmetry with `orbit-rings` (same shape, IS named + converted). Documented, deliberate. |
| Velocity Flames | `velocity-flames` | trigger | `trig.ageMs` (flame height) + `ctx.timeMs` (flicker) | **Hybrid.** Flame height is already hit-relative via age; only the cosmetic flicker reads wall-clock. Flagging `voice` would make the flicker hit-relative too → **not byte-parity**, and it is not in the named set → left absolute. See S27 note. |

## N/A — hit-driven (seq + dt) / param-driven; timebase flag immaterial ✅

These read no phase clock and no `trig.ageMs` — only `trig.seq` (one-shot spawn per hit) + real
`ctx.dt` (physics), or a plain param. They already restart per hit via `genState`/`seq`, so the
flag changes nothing. **No flag added.**

| Effect | id | Cat | Time source | Notes |
|---|---|---|---|---|
| Confetti Burst | `confetti-burst` | particle | `trig.seq` (spawn) + `ctx.dt` | Restart via new seq → fresh particles. |
| Pixel Accum | `pixel-accum` | trigger | `trig.seq` + `ctx.dt` (decay) | Accumulator; reset on respawn. |
| Colour Melody | `colour-melody` | trigger | `trig.seq` (held colour) | Latches a colour on each new hit. |
| Swing | `swing` | trigger | `trig.seq` + `ctx.dt` (decay) | Envelope accumulator. |
| Sidechain | `sidechain` | utility | `trig.seq` + `ctx.dt` (recover) | Gain-duck accumulator. |
| Meter EQ | `meter-eq` | meter | `level` param only | No time clock at all; level is externally modulated. |

---

## Decisions & tensions (surfaced for the reviewer + S27)

1. **Textures are a single-flag compromise.** Doc 06 §A wants textures "voice when
   trigger-hosted" but "absolute when used as looks". `timebase` is one value per registry
   entry, and both bridges route *every* effect (looks included) through the same `renderVoice`
   path — so a texture can't be both. The hard constraint (looks must not phase-snap on recall)
   and the S25 recipe's verbatim instruction both point the same way: **textures stay absolute**.
   A true per-instance override (voice-when-hosted-on-a-trigger) would need a **voice/bus-level**
   timebase, not a per-effect flag — out of S26 scope (fits the doc 06 §C modifier / doc 10
   modulation work). This is the one place S26 knowingly does not fully satisfy doc 06's wish.

2. **`synced-hoops` is `category:'base'` but converted.** The enumerated stay-absolute set is
   exactly breathing-kit / hue-rotate-kit / solid-base; `synced-hoops` is named in the conversion
   list in **both** the assignment and the slice spec. Category is a palette grouping, not a
   timebase directive — converted per spec.

3. **`comet-trails` reads no clock.** It's in the Tier-1 named batch and restarts on retrigger,
   but purely via `genState` reset (dt accumulator). Its total accumulated `dt` is birth-time
   independent, so it is excluded from the birth-dependence golden (proven by restart + no-leak
   instead). Flagged `voice` anyway (named batch + S27 contract).

### Notes for S27 (thumbnails)

- `gen.timebase === 'voice'` is now the **complete** set of hit-relative effects (Tier 1 + Tier
  2). Drive those thumbs with a looping trigger age; keep wall-clock for `absolute`.
- **Seq-driven effects** (confetti-burst, pixel-accum, colour-melody, swing, sidechain) are
  `absolute`-flagged but animate via **new-hit seq**, not age — their thumbnails need the
  synthetic trigger's **seq bumped**, not just a looping age.
- **`velocity-flames`** is a hybrid: its flame animates from trigger age (loop the trigger age)
  while its flicker wants wall-clock. A binary flag can't express both; S27 should loop its
  trigger age regardless of the `absolute` flag if a frozen flame reads poorly.
