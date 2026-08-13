# G4 — Settings feedback round: stacked fields, fewer colours, free zones, OSC learn

**From Trent reviewing G3 on the live preview, 2026-08-14** (with a screenshot of the Output
card; described below since you can't see it). Base: `feat/settings-sections` at `fb45de7`,
push updates PR #180. Effort high.

## 1. Field layout — app-wide in Settings

Target (from Trent's screenshot of the Output card): fields in a **2×2 grid**, **label ABOVE
the field** (small quiet label, then the input), **no help text below fields**. Card header =
title left, port badge right; CHAIN list below; read-rows at the foot.

- Extend/replace the `Field` primitive with a stacked (label-above) variant — one primitive,
  used everywhere in Settings; kill the per-pane side-label layouts.
- Apply across **all** settings panes: fields arranged in columns (2-up where widths allow;
  a genuinely wide field spans full width).
- Delete the hint lines under fields ("display label", "3 = RGB · 4 = RGBW", "blank = dense /
  auto", …). Where a hint is genuinely load-bearing (the blank-means-dense/inherit
  semantics), fold it into the input's placeholder (e.g. placeholder "dense / auto") or an
  info tooltip on the label — never visible text under the field.
- **The Controller page is "a particular mess"** (Trent's words) — give it the full
  treatment: same stacked-label grid system, coherent groups. The watchController lifecycle
  and one-screen-plus-short-tail budget from G3 still hold; don't regress either.

## 2. Colour discipline on chips/pills

Trent: pills have "weird colours like the text not matching the background — there are too
many colours on the outputs and chains page."

- A chip's text/border/background must come from ONE tint recipe so they always match
  (tint text + tint-derived border + neutral/near-neutral fill — pick one recipe, apply to
  every chip: port badge, drum chips, TypeChips everywhere).
- Reduce the hue count on Outputs & Chains specifically: the section already has an identity
  hue; chips inside it should be mostly neutral (ink on surface) with AT MOST one accent
  family doing real work (e.g. drum identity). If drum chips keep per-drum colours, everything
  else goes neutral. Your design call, but the page must read as "a couple of deliberate
  colours", not a fruit salad. Apply the same recipe app-wide so Settings stays one system.

## 3. Zones rework — model change AUTHORIZED (fence lifted, carefully)

Trent: zones are just "assigning a MIDI note to a drum and giving it a name" — the Sensory
Percussion slot linkage is dead.

- **Remove the slot dropdown**; each zone gets a **free-text name field** instead.
- **Remove the per-drum zone limit** — add as many zones as you like.
- **Zones collapse/expand** (drum sections and/or zone cards — your judgment; default state
  should keep the pane scannable with many zones).
- **Add OSC learn buttons** on zone OSC-address fields, and on every other OSC input field
  in Settings that lacks one (audit them). MIDI zone learn exists; mirror the pattern
  (`startOscLearn` targets — extend the target union if needed).

Model guidance (verify all of this against code before building):
- Zone identity today is `(drumId, slot)` (`project.inputMap.zones`), and **trigger graphs
  reference zones through their trigger source / padKey** — engine resolution and existing
  graph bindings must keep working. Prefer: keep the numeric slot as the stable identity
  (auto-assigned, never user-facing), lift whatever cap exists, and carry the display name
  as data (either a `label` on the zone entry in core's InputMap schema, or the existing
  `patchLabels` `zone:*` key family — pick ONE, state why).
- Fence lift: `packages/core` InputMap schema + its zod (greenfield posture: bump/change the
  schema outright, no migration machinery), `packages/protocol` if the wire type moves,
  server-side validation if it constrains zone count, the pure zone helpers
  (`docks/patch-inspector.ts`) + their tests, and the store ONLY for learn-target/OSC-learn
  additions. `setInputMap` stays the single mutation gate (mutation parity — every path
  through the same validation). Engine behaviour (zoneForNote/zoneForOsc, padKey) unchanged.
- Heads-up: `feat/graph-list-177` also touched `store.svelte.ts` (markGraphFire area) — you
  are branched from before that; avoid gratuitous edits near it to keep the eventual merge
  clean.

## 4. Unchanged rules

Design system + styleguide regen in the same change (the stacked Field variant is a
styleguide-worthy primitive change), /make-interfaces-feel-better, tokens only, AA on sRGB,
tests move with behaviour (zone helpers, InputPane/DrumZonesPane tests will need reshaping —
assertions evolve with the model, don't delete coverage), ui-shots of every pane after the
relayout + the zones pane with many zones + collapsed state + an OSC learn armed. Gates green
on committed HEAD, twux push, verify sha. Ports: preview holds 5373/4323/9102.

## Escalation triggers

- Zone identity can't stay slot-stable without breaking existing graph trigger sources.
- The zone cap turns out to be structural in the engine (not just UI/validation).
- Anything that would change engine resolution semantics.
