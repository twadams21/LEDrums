# Rock Solid — slice plan index

Parent PRD: issue #45 · Context docs: [`docs/plans/2026-07-02-rock-solid/`](../INDEX.md)

49 vertical slices (S01–S49) in 12 feature groups (A–L), one GitHub issue per group. Each slice
is a tracer bullet: a thin end-to-end path, demoable or test-verifiable on its own, sized for a
single implementer-agent sitting (~15–25 min). Slice IDs are stable — use them in commits
(`S17: …`) and cross-references.

## Model guidance (tags, not model names)

The orchestrator chooses models. Tags carried by every slice:

- `effects` / `modifiers` / `modulation` — effect-engine creative work → strongest implementer tier
- `ui-significant` — new UI surfaces or graph-editor internals → strongest implementer tier
  (and every UI-touching slice applies `/make-interfaces-feel-better` per AGENTS.md)
- `ui-light` — small UI additions to existing surfaces
- `plumbing` — protocol/server/persistence/io work with strong test seams
- `mechanical` — wide-but-shallow batch edits following an established pattern

## Groups

| Group | Issue | File | Slices | Cross-group blockers |
|---|---|---|---|---|
| A — Graph editor hardening | #46 | [A-graph-hardening.md](A-graph-hardening.md) | S01 | none |
| B — IO confidence surfaces | #47 | [B-io-confidence.md](B-io-confidence.md) | S02–S05 | none |
| C — Desktop shell & updates | #48 | [C-desktop.md](C-desktop.md) | S06–S08 | none |
| D — Layout & kit geometry | #49 | [D-layout-geometry.md](D-layout-geometry.md) | S09–S11 | none |
| E — Input routing & section looks | #50 | [E-routing-looks.md](E-routing-looks.md) | S12–S17 | none |
| F — Effect params & envelopes | #51 | [F-effect-params-envelopes.md](F-effect-params-envelopes.md) | S18–S24 | none |
| G — Timebase & thumbnails | #52 | [G-timebase-thumbnails.md](G-timebase-thumbnails.md) | S25–S27 | none |
| H — Modifier nodes | #54 | [H-modifiers.md](H-modifiers.md) | S28–S32 | S01 (#46), S18 (#51) |
| I — Modulation system | #57 | [I-modulation.md](I-modulation.md) | S33–S38 | S29 (#54), S23 (#51) |
| J — Presets & Song Library | #53 | [J-presets-song-library.md](J-presets-song-library.md) | S39–S42 | none |
| K — Clipboard portability | #55 | [K-clipboard.md](K-clipboard.md) | S43–S45 | S40 (#53) |
| L — PixLite integration | #56 | [L-pixlite.md](L-pixlite.md) | S46–S49 | S03 (#47, only S48) |

## Full dependency table

| ID | Title | Blocked by | Tags |
|---|---|---|---|
| S01 | Graph editor hardening | — | ui-significant |
| S02 | OutputPill truth from OutputStatus | — | ui-light, plumbing |
| S03 | Output status panel | — | ui-significant |
| S04 | Input activity badges | — | ui-light |
| S05 | MIDI device list in settings | — | ui-light |
| S06 | Boot progress field + desktop-bridge | — | plumbing |
| S07 | Settings update progress + in-app badge | S06 | ui-light |
| S08 | Boot overlay + shell reduction + share gating | S06 | ui-significant |
| S09 | Right-dock resize rail | — | ui-light |
| S10 | Per-drum flip (+ pixelsPerHoop fix) | — | plumbing, ui-light |
| S11 | Kit mirror X/Y | S10 | plumbing, ui-light |
| S12 | Kill echo re-fire + offline-gated sim | — | plumbing |
| S13 | Keyboard fireGraph intent message | S12 | plumbing |
| S14 | Drum-link indicator + unrouted event | S12 | ui-light |
| S15 | Engine section looks (spawn/release) | S12 | plumbing |
| S16 | Looks authoring UI + model | S15 | ui-significant |
| S17 | LayersDock server truth | S12 | ui-light |
| S18 | Enum params end-to-end | — | effects |
| S19 | Colour batch 1: swatch + hit/trigger effects | — | effects |
| S20 | Colour batch 2: wash/base/utility/meter | S18, S19 | effects, mechanical |
| S21 | Colour batch 3: textures | S19 | effects, mechanical |
| S22 | Colour batch 4: particles | S19 | effects, mechanical |
| S23 | Envelope core v2 (eases, attackLevel, migrator) | — | effects |
| S24 | EnvelopeEditor component rework | S23 | effects, ui-significant |
| S25 | Timebase infra + chase tracer | — | effects |
| S26 | Timebase conversion batch | S25 | effects, mechanical |
| S27 | Thumbnail fidelity | S25 | effects |
| S28 | Modifier engine core + Trail | — | modifiers |
| S29 | Modifier graph layer (toPort/mod handle) | S01, S28 | modifiers, ui-significant |
| S30 | Modifier batch 2: Bloom/Sparkle/Grain/Strobe | S29 | modifiers |
| S31 | Modifier batch 3: Echo/Pixelate/Mirror/colour set | S29, S18 | modifiers |
| S32 | Modifier second wave | S29 | modifiers, mechanical |
| S33 | Modulation core (mapping model + sweep) | S23 | modulation |
| S34 | Modulation graph layer: Envelope node + param rows | S29, S33 | modulation, ui-significant |
| S35 | EnvMap migration + removal | S34 | modulation, mechanical |
| S36 | LFO node end-to-end | S34 | modulation |
| S37 | CC-In node end-to-end | S34 | modulation |
| S38 | Signal previews + param-row ticks | S36, S37 | modulation, ui-significant |
| S39 | Remove linked presets | — | plumbing, ui-light |
| S40 | Library persistence + closure extraction | S39 | plumbing |
| S41 | Library refs/resolve/detach/guards | S40 | plumbing |
| S42 | Library UI + naming pass | S41 | ui-significant |
| S43 | clipdoc module (serialize/parse/remap) | S40 | plumbing |
| S44 | Clipboard copy/paste UI | S43 | ui-light |
| S45 | Patch copy/paste: setProject + diff dialog | S43 | plumbing, ui-light |
| S46 | PixliteClient in io + fake | — | plumbing |
| S47 | Discovery + controller-monitor service | S46 | plumbing |
| S48 | Controller panel UI | S47, S03 | ui-significant |
| S49 | Controller test patterns + takeover state | S48 | ui-light |

## Verification contract (every slice)

Full sweep green before hand-back: `pnpm typecheck` (all pkgs, 0 errors) + `pnpm test`
(no skips). New behavior tested at the confirmed seams (PRD "Testing Decisions"): core engine
input→frame/diagnostics, server handlers with fakes, web store/pure slices, and the three new
seams (PixliteClient fake, desktop-bridge fake, clipdoc). Migrators always ship with parity +
idempotency tests. No `packages/core` impurities. UI slices apply `/make-interfaces-feel-better`.
