# The Generator standard

How every Generator plugin lays out its settings, so they all read the same way. Agreed with
Tim on 2026-10-06/07, after building Dot showed how far the plugins had drifted apart ("I want
there to be a commonality, or standard flow/order that the various different plugins have").

New plugins follow it from the start; existing ones are brought in line one at a time. When a
plugin genuinely can't follow a rule, say why in its file — don't quietly differ.

## Rule 1 — each card has one job

| Card | Its job | Never |
|---|---|---|
| Trigger | When it fires, and the brightness envelope | — |
| **Generator** | What the light is, where it starts, how it moves, its colour | Overall brightness or fading out — those are the Effect's Opacity and the Trigger's envelope |
| Modifiers | Change the finished picture (strobe, trail, mirror…) | Make light |
| Controls | Move a setting over time — and **Velocity**: a Velocity Control makes any setting respond to how hard the drum is hit | — |
| Target | Where light is allowed to show | — |

So a Generator has **no Brightness** setting (the Effect's Opacity is the one place) and **no
Decay** that the envelope already does. A per-element life (Dot's Lifespan) is fine — it is what
the light looks like, not how long the hit lasts.

## Rule 2 — the same sections, in the same order

A plugin uses only the sections it needs, but never reorders them. Section titles are shown in
capitals.

**What and where**

1. **FORM** — what it is. Named for the plugin (DOTS, SPLICES, WAVE…). How many (the plugin's own
   word: Dots, Comets, Splices — Tim prefers these to a generic "Count"), anything only this
   plugin has (Arms, Bands, Segments), and Seed.
2. **START** — where it begins. Start drum · Start hoop · Start angle — or a Start point in the
   kit's space — and Spread out.
3. **SHAPE** — how big and what shape. Length · Height (hoops) · Width · Shape · Glide · Trail.

**How it behaves**

4. **MOVEMENT** — every kind of motion, in one section. Through (Hoop / Drum / Kit / Space) ·
   Speed (units ⇄ beats) · Direction · Travel angle (or Flight, through space) · Order · the
   edges (Wrap / Bounce / Random / Ping-pong / Leave) · Accel. A plugin that moves in two clear
   ways (Splice, Slice) keeps them as labelled sub-headings inside MOVEMENT — Around, Through —
   not as two sections.
5. **TIMING** — when and for how long. Spawn · Interval · Lifespan · Fade in/out · Max alive ·
   the per-hoop / per-drum / per-colour offsets (Splice's chase). Always after MOVEMENT.

**How it looks and reacts**

6. **COLOUR** — ALL colour lives here, picked from **colour boxes — no Hue / Saturation sliders**
   (Tim, 2026-10-07: "isn't it more concise just picking the colour from the window that opens
   when you click the colour box?"). Colours: Single (one box) / Per dot / Per hit / Per pixel /
   Random — every mode but Single reads a **Palette**, a row of boxes in order, like Splice's
   bands, with a fill round the colour wheel. Change: Off / To colour (a box, Blend Fade or Wheel,
   a Time) / Cycle (a Speed). A plugin with several fixed colours (Temperature's warm and cool,
   Hogs and halos) shows them here as boxes. Behind each box the hue / saturation / brightness
   stay settings of their own, so a Control can still drive them.
7. **BACKGROUND** — None / Same / Other · Level · its colour box.

**There is no VELOCITY section.** Velocity is the **Velocity Control** — its own card, which can
make ANY setting respond to how hard the drum is hit (Tim, 2026-10-07: "choosing which particular
param within a given plugin i want to make velocity sensitive"). A plugin has no velocity
settings of its own. Still to build: letting it drive the Effect itself — Opacity and the
envelope's Attack / Sustain / Decay.

**There is no RANDOM section.** A setting that can vary gets its own **Random** slider directly
under it — always called Random, always looking the same — so Random angle sits under Start
angle and Random colour under Colour. (Tim, 2026-10-07: random settings "generally work being
in" the places they vary.)

## Rule 3 — one word for one idea

| Use | Not |
|---|---|
| **Colour** (well + Hue + Saturation) | Base Hue, Warm / Cool Hue, Hog Hue, Flash Hue, Tint |
| **Spread** | Hue Span, Hue Range, Hue Spread |
| **Change → Cycle** | Hue Drift, Hue Shift, Hue Rotate |
| **Trail** | Tail, Afterglow |
| **Random** | Jitter, Hue Jitter, Random (as a standalone amount) |
| **Speed** | Fall Speed, Travel, Rate — except a rate of repetition (Strobe, Breathe), which stays Rate |
| **Edges**: Repeat · Bounce · Random · Ping-pong · Leave | Bounce (as the setting's name), Wrap — "Cycle" is taken by colour Change, "Loop" by Sustain |

## Rule 4 — one control for one kind of setting

| Setting | Control |
|---|---|
| A drum | Drum picker ("Drum you hit" first) |
| An order of drums | Drum chips to drag (or ← / →) |
| A hoop | A button per hoop of that drum |
| A place round a hoop | The hoop ring — the hoop seen from the throne, front at the bottom, its right on the right |
| A point in the kit's space | The kit from the Top and the Front, click to place |
| A way through space | Flight — the kit from the Top and the Front with the effect running live |
| A colour | A colour box (opens the colour window) — no sliders |
| Several colours in order | A palette: a row of colour boxes, − / + and a fill round the wheel |
| A time or a rate | The value, with the ms / Hz ⇄ beats chip |
| An explanation | ⓘ beside the label — never a paragraph on the card |

## Rule 5 — the card never moves

Changing a mode (Through, Colours, Spawn…) must not rearrange the card (Tim, 2026-10-07: Dot
"rearranges the entire card, which is super annoying and not user friendly … there needs to be
a certainty of where on the card they will appear each time").

- **Fixed slots.** Settings that are alternatives of each other share one place of one size
  (`ParamSpec.slot`) — the hoop ring and the space Start point; Length and Size; Travel angle and
  Flight; Colour and Palette; Time and Speed. Changing the mode swaps what is in the slot; nothing
  around it moves.
- **Dim, don't hide.** Any other setting that doesn't apply in the current mode stays where it
  is, greyed out, its ⓘ saying when it applies ("Only through Space").
- Sections keep their columns.

## In code

- Sections and conditions are declared in core on each param (`ParamSpec.section`, `showIf`,
  `widget`, `swatch`, `rangeFrom`, `partOf`); the card draws them generically
  (`apps/web/src/lib/app/views/effects/strip/cards/ParamRows.svelte`). A new plugin gets the
  standard by declaring, not by building its own card.
- The section order is to be held in one list in core with a test, so a plugin that strays fails
  CI rather than drifting (rollout step 1).

## Rollout

1. ✅ The order held in code (`GENERATOR_SECTIONS`, `effects/generator-standard.test.ts`);
   dim-instead-of-hide, fixed slots and colour boxes in the card (2026-10-07).
2. ✅ Dot brought fully in line (2026-10-07).
3. The older Styles swept: sections, the standard words, Brightness removed. No change to how
   anything looks or plays apart from Brightness moving to Opacity.
4. Splice and Slice: one MOVEMENT with Around / Through sub-headings; their colours into COLOUR.
