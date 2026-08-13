# WebKit vs Chromium colour divergence — measured, 2026-08-13

**Verdict: the hypothesis was wrong, and there is no colour-maths divergence left to fix.**
`color-mix(in oklch, …, transparent)` renders identically in both engines. The only
cross-engine colour difference that survives measurement is *which token rendition each
engine picks*, because the two engines answer `color-gamut: p3` differently on the same
machine. That one is real, is not fixed here, and needs a product decision — see
[What is still open](#what-is-still-open).

## The hypothesis under test

After the 2026-08-10 gamut work (`feat/color-tokens-p3-srgb`, shipped in v0.2.14) fixed the
P3/sRGB side, the remaining suspicion was that every
`color-mix(in oklch, var(--x) N%, transparent)` renders differently in WebKit than in
Chromium — `transparent` being transparent *black*, and mixing toward it in a cylindrical
space being somewhere WebKit might resolve the endpoint's lightness and hue differently.
The proposed fix was to rewrite all 69 such call sites to
`oklch(from var(--x) l c h / N%)`.

That hypothesis is **falsified**. No rewrite was done.

## How it was measured

Two new tools, both comparing Chromium and WebKit through Playwright:

- **`apps/web/scripts/engine-color-parity.mjs`** — renders swatches of specific colour
  expressions in both engines, screenshots, and samples actual pixels (a computed style is
  only what an engine *says* it will paint). Each case carries a `base` swatch of the raw
  token as an experimental **control**.
- **`apps/web/scripts/engine-color-diff.mjs`** — walks the whole running app in both
  engines and diffs every resolved colour, attributed to the element that paints it.

Both run two passes: **free** (each engine answers `color-gamut` for itself, i.e. what
ships) and **pinned** (both engines forced onto identical token values, isolating how they
*paint* from what they *choose*). The app diff matches elements on tag **and** class and
freezes animations, so app state and animation phase can't masquerade as a colour bug.

The control earned its place immediately: the first run flagged a Δ23/255 divergence that
looked like a mixing bug and was actually the token itself resolving differently. Without
it, that would have been read as confirmation of the hypothesis.

## Finding 1 — the colour maths is identical in both engines

Computed values, both engines, byte-for-byte:

```
color-mix(in oklch, oklch(0.845 0.19 128) 55%, transparent)
  chromium → oklch(0.845 0.19 128 / 0.55)
  webkit   → oklch(0.845 0.19 128 / 0.55)
oklch(from oklch(0.845 0.19 128) l c h / 55%)
  chromium → oklch(0.845 0.19 128 / 0.55)
  webkit   → oklch(0.845 0.19 128 / 0.55)
```

Premultiplied alpha cancels the transparent-black endpoint exactly as CSS Color 4 specifies,
and WebKit gets it right. Widened to **504 cases** — 4 interpolation spaces
(oklch/oklab/srgb/hsl) × 9 percentages (1–99) × 7 colours including `black`, `white` and an
achromatic grey × both argument orders, composited over `rgb(58,58,58)`:

| measurement | worst delta |
| --- | --- |
| `color-mix(…, transparent)`, chromium vs webkit | **0.049 / 255** |
| `color-mix(…, transparent)` vs `oklch(from … / a)` | **0.049 / 255** |

Zero, twice. The proposed replacement is *numerically identical to what it would replace*,
in both engines. Rewriting the 69 sites would have changed nothing on screen — it could
neither have caused the reported problem nor fixed it. Both forms are kept as regression
cases in the parity harness so this stays measured rather than remembered.

## Finding 2 — the whole app agrees, once the engines agree on the tokens

`engine-color-diff.mjs` across 6 views, 1440×900, animations frozen:

| pass | elements compared | distinct diverging colours |
| --- | --- | --- |
| free (each engine picks its own rendition) | 4881 | **1** |
| pinned (identical token values) | 4883 | **0** |

Zero divergence under pinning means the engines **paint identically** — there is nothing
left for either to gamut-map, which is exactly what the 2026-08-10 work set out to achieve.
The single free-pass difference is `--border-accent`, at Δ2.9/255 (~1%): invisible, and the
dual-rendition system working as designed.

## Finding 3 — the real remaining divergence is *who answers `color-gamut`*

In identical headless conditions on the same machine:

```
matchMedia('(color-gamut: p3)')   chromium → false      webkit → true
--live-bright resolves to         oklch(0.7 0.1898 25)  oklch(0.700 0.230 25)
painted                           (255,100,95)          (255,77,79)      Δ 23/255
```

WebKit reports P3 essentially unconditionally; Chromium answers from the actual display. So
the two engines take opposite branches of the generated rendition block in `tokens.css` and
paint materially different colours **on one machine** — which is what "the desktop app looks
different from Chrome on the same Mac" would actually look like. Δ23/255 on `--live-bright`
is well past visible; `--border-accent`'s Δ2.9 is not.

Two caveats, stated rather than buried:

- Headless Chromium has no display attached, so its `srgb` answer is partly an artifact of
  the harness. The *disagreement* is the finding; the exact number is environment-specific.
- Playwright's WebKit is not Apple's WKWebView. It is the closest available proxy, not the
  shipping engine.

Checked and cleared while here: the runtime clamp path
(`apps/web/src/lib/ui/oklch-gamut.ts`, used for LayersDock voice tints and show-derived
hues) keys off the **same** `matchMedia('(color-gamut: p3)')` as the CSS, so CSS and JS
cannot disagree within one engine. No double-mapping. Also verified the gamut fix actually
shipped: commit `1604d21` is an ancestor of both `v0.2.14` (2026-08-10) and `v0.2.15`, so
any machine on a current build already has it.

## What is still open

`--live-bright` (chroma 0.230 vs 0.1898) is the one token whose two renditions differ enough
to be visible if two engines disagree about the display. Options, none taken here because
this is a product call:

1. **Leave it.** On a genuinely P3 MacBook panel, WebKit's answer is correct and the vivid
   rendition is the intended one. If Tim's colours are still wrong on a current build, this
   is the first thing to check — and the check is now one command.
2. **Trust a runtime probe over the media query** — serve the sRGB rendition unless P3 is
   positively confirmed. Safe, but gives up wide-gamut punch on displays that have it.
3. **Re-author `--live-bright`** so both renditions sit inside sRGB, removing the divergence
   at the cost of the extra chroma on P3.

## Running these

```bash
node apps/web/scripts/engine-color-parity.mjs --verbose   # expression-level; no server needed
pnpm dev                                                  # then, in another shell:
node apps/web/scripts/engine-color-diff.mjs --base http://localhost:5173
```

Both need the Playwright WebKit engine: `node node_modules/playwright-core/cli.js install webkit`.
This is a dev-machine action, not a dependency — nothing was added to `package.json`.
