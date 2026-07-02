# 10 — Modulation system: Envelope / LFO / CC nodes → parameter mappings

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).
> Designed in conversation with Trent 2026-07-02; **all decisions in this doc are LOCKED**.
> Supersedes doc 05's per-node envelope *placement* (the shape/easing work there still applies —
> it moves into the Envelope node) and builds on doc 06's wiring infrastructure (`toPort`,
> source-kind hit-test routing, multi-row node faces). **Ships in the first wave, in dependency
> order after doc 06's wiring infra.**

## The idea

Envelopes become graph nodes, so one envelope can drive many parameters across many effects — and
the same mechanism lets a MIDI CC (and an LFO) drive any parameter. Three wire classes now exist
in a trigger graph: **trigger flow** (fires things), **mod chain** (transforms pixels, doc 06),
**modulation** (drives parameters, this doc). Modulation sources and targets are all explicit,
visible structure — no hidden per-node env maps (see memory `sharing-via-explicit-wiring`).

## Model

### Source node kinds (new `GraphNode` kinds)

| Kind | Signal | Clock / semantics |
|---|---|---|
| `envelope` | ADSR shape from doc 05 (per-segment eases, `attackLevel`) | **Per-voice**: each hit of each target play node runs its own instance over that voice's life; retrigger restarts it. Shared shape, independent phases. |
| `lfo` | waveform (sine/tri/saw/square/S&H), rate | **Continuous, deterministic**: pure function of engine time + bpm. Rate as free Hz **or** musical division (reuse the delay-node division vocabulary/`computeDelayMs` pattern). Phase offset param. Affects all live voices of its targets, including looped/base voices. |
| `ccIn` | live MIDI CC value 0..1 | **Continuous, input-driven**: engine keeps a CC value table updated by the already-queued `{t:'cc'}` input events (protocol msg exists; CC#0 stays reserved for section recall). Params: controller #, channel filter, MIDI-learn (reuse the learn flow). |

Source nodes are display-only faces (locked graph idiom); their own settings (shape editor,
waveform/rate, CC number) are edited in their Inspectors — the doc 05 envelope editor
(per-segment easings, draggable attack level) becomes the `EnvelopeNodeInspector`.

### Target side: mappable parameter rows (LOCKED — Trent's design)

- **Mappings are only editable on the target (play/modifier) node** — never on the source node.
  The source node's Inspector may *display* where it's wired (read-only), but all mapping edits
  happen target-side.
- A target node carries `modInputs: { param: string }[]` — the ordered list of **exposed**
  mappable params. **Empty by default.** The target node's Inspector has "Add parameter" → picker
  over that node's numeric params (effect params for play nodes; modifier params for modifier
  nodes — same mechanism, same rule).
- Each exposed param renders as **its own row on the node face**: an input handle + the param
  label on that row. 10 exposed params = 10 rows = 10 handles. Each row is its own drop target,
  **scoped to modulation-source nodes** (connection validation rejects trigger-flow/modifier
  wires; pure validator in `graph-wiring`, returns — never throws, per doc 09).
- Precedent: value-band switches already render per-band source handles (`band-${i}`) — this is
  the same multi-handle NodeCard mechanism on the input side. The drop-anywhere-on-node hit-test
  routes by source kind (doc 06): a wire dragged from a modulation source snaps to param rows
  (nearest row / row under cursor), not to `in`/`mod`.
- Edge model: `GraphEdge.toPort: 'in' | 'mod' | `param:<paramKey>`` (extends doc 06's field).
- **Per-mapping settings** (edited under the param's row in the target Inspector, one entry per
  incoming wire): `amount` (depth 0..1), `invert`, `rangeMin`/`rangeMax` (defaults = the param
  spec's min/max). Multiple sources may wire into one param row; contributions **sum**, clamped
  to the param spec range.

## Engine semantics (core — pure + deterministic)

- At voice spawn, graph compilation resolves each play node's (and its modifier chain's) exposed
  params + incoming modulation edges into `voice.modulations: Mapping[]`
  (`{ targetParam, source: {kind, ref}, amount, invert, rangeMin, rangeMax }`). The compositor
  never sees graph topology.
- The param sweep (`compositor.ts:58-77` today, env-only) generalizes:
  `effective[key] = clamp(base + Σ contribution(mapping), spec.min, spec.max)` where a
  contribution samples its source — envelope by `voicePhase` (existing sampler, doc 05 shapes),
  LFO by `(timeMs, bpm)` pure function, CC by the engine's CC table — then invert → scale into
  [rangeMin, rangeMax] weighted by amount.
- CC table: a small `Map<channel:controller, value>` on the engine updated in `processEvent` from
  queued cc events — inputs are events, so determinism holds (same input log → same frames).
- `v.env`/`EnvMap` is **removed** after migration (below). Web sim mirrors all of this
  (`sim` param application + its tick) for offline parity.

## Migration (hydrate-time, idempotent — `foldVelocitySwitch` pattern)

Each play node's existing `env: EnvMap` entries convert to: one `envelope` node (per distinct
shape per graph, positioned near its first target), auto-exposed param rows on the play node for
each enveloped key, and modulation edges with `amount = env.amount` (range = spec min/max, the
current sampler's behavior — parity-testable). Then drop the `env` field. Old shows load
byte-equivalent in behavior; migrator runs beside the linked-removal and curve→eases migrators.

## UI summary

- Palette gains Envelope / LFO / CC In under a "Modulation" group; node faces show kind icon +
  name (+ CC number / LFO rate as the mono sub-line).
- **Node-face previews (Trent, 2026-07-02)**: every modulation-source node shows what it's doing
  over time, right on the card — the `EffectThumb` right-slot precedent, but for signals:
  - **Envelope**: the shape curve as a mini sparkline (pure SVG path from `adsrToPoints` — cheap,
    static, updates on shape edit); when voices are live, a phase cursor sweeps it.
  - **LFO**: the waveform with a moving phase dot / scrolling window driven by the shared
    thumb ticker (`effect-thumb-ticker` singleton — do NOT add another rAF loop).
  - **CC In**: a live value bar + numeric readout (last value, updates from the cc stream).
  - Reduced-motion: static shape/waveform, value as number only (same policy as EffectThumb).
  These are data displays, not decorative motion — they don't violate the no-lift/no-animation
  graph rule (memory `graph-interaction-prefs`), but they must be cheap: one shared ticker,
  render only while on-screen (IntersectionObserver, same machinery as thumbnails).
- Modulation wires get their own role colour (third class, must read at a glance vs trigger flow
  and mod chain).
- Target Inspector: "Parameters" section — Add parameter, per-param row (label, live value
  readout, mapping list with amount/invert/range, remove-exposure guard: removing an exposed
  param deletes its incoming wires after confirm).
- Param rows on the node face show a small live-modulation tick (value indicator) when the engine
  is running — this is also the confidence story: you can *see* the CC moving the param.

## Touch list

- core: `voice/types.ts` (node kinds, `modInputs`, `toPort` param variant, `Mapping`),
  `eval-graph.ts` (skip mod-source kinds in fire flow; resolve mappings at spawn),
  `voice-pool.ts`, `compositor.ts` (generalized sweep), engine CC table (`engine.ts`
  `processEvent`), LFO pure fn (`voice/lfo.ts`), envelope sampling reused from doc 05
- web: sim mirrors (types/tick/param application), store mutators (`addModInput`,
  `removeModInput`, `setMappingAmount/Invert/Range`, connect/reconnect `toPort` carry —
  extends doc 06's), `graph-to-flow.ts` + `NodeCard`/`TriggerNode` (param rows + handles),
  hit-test routing, `GraphPalette`, new `EnvelopeNodeInspector`/`LfoNodeInspector`/
  `CcInNodeInspector` + target-Inspector Parameters section, `persistence.ts` (coercion +
  EnvMap migrator), wire styling tokens

## Tests

- Core: mapping resolution from topology (multi-source sum, clamp, invert, range); envelope
  restarts per voice/retrigger; LFO determinism (same t/bpm → same value) + division sync;
  CC table update via events + live modulation of running voices; mod-source nodes inert in
  trigger-flow eval; migrator parity (pre-migration env sweep vs post-migration mapping sweep
  sample-identical) + idempotency.
- Web: connection validation scoping (param rows accept only mod sources; `in`/`mod` reject
  them); add/remove exposed param (remove deletes wires); projection renders N rows/handles;
  store round-trip of `toPort: param:*`; sim/engine parity fixture.

## Decisions (LOCKED 2026-07-02)

- Mapping editing is **target-side only**; targets expose an explicit, initially-empty param list;
  each exposed param = its own node-face row + scoped input handle (Trent's design, verbatim).
- Per-voice envelope semantics; continuous LFO/CC semantics (as above).
- Inline `env: EnvMap` is migrated to nodes and removed — no dual mechanism.
- **LFO is in the first cut** alongside Envelope and CC.
- Ships in the **first wave**, after doc 06's wiring infra (dependency), alongside doc 05's shape
  work (which relocates into the Envelope node).
