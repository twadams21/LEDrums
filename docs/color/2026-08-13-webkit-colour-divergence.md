# WebKit vs Chromium colour divergence — measured, 2026-08-13

**Verdict: the hypothesis was wrong, and there is no colour-maths divergence left to fix.**
`color-mix(in oklch, …, transparent)` renders identically in both engines. The only
cross-engine colour difference that survives measurement is *which token rendition each
engine picks*, because the two engines answer `color-gamut: p3` differently on the same
machine. That one was real, and it **is now fixed** — `--live-bright` was re-authored
inside sRGB so there is only one rendition left to disagree about. See
[The fix](#the-fix--live-bright-re-authored-inside-srgb).

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

## The fix — `--live-bright` re-authored inside sRGB

Three options were put to Trent: leave it (WebKit's answer is correct on a real P3 panel),
trust a runtime probe over the media query, or re-author the token inside sRGB. **Trent
chose the third** (2026-08-14): one value, in gamut everywhere, nothing left for either
engine to choose between.

```
- --live-bright: oklch(0.700 0.230  25);   sRGB excursion 0.06422  (inside P3 only)
+ --live-bright: oklch(0.700 0.1898 25);   sRGB excursion 0.00000  (inside sRGB and P3)
```

Lightness and hue are held exactly; only chroma gives way, down 17.5%. The new value is the
one `gamut-tokens.mjs` had already computed as the sRGB rendition — the maximum chroma that
fits at L 0.700 / H 25, with the generator's own safety margin — so it is by construction
the closest in-gamut colour to the original intent.

**Perceptual cost: ΔE2000 3.70, ΔE OKLab 0.0402.** Above the ~2.3 "just noticeable"
threshold side by side, so on a P3 display the LIVE red is marginally less saturated than
before; it holds its lightness and hue, which is what makes it read as the same red across a
room. That was the trade Trent accepted, and it buys a 23/255 difference between the desktop
app and the browser going away.

The token's `:root` entry now carries the constraint in a comment, because the obvious future
edit is someone restoring the punch and silently reintroducing the divergence.

### After

| measurement | before | after |
| --- | --- | --- |
| parity harness, Section B worst token divergence | Δ23.0/255 | **Δ0.0/255** |
| `--live-bright` entries in the generated rendition block | 1 | **0** |
| whole-app free-pass diverging colours | 1 (`--border-accent`) | 1 (`--border-accent`) |
| whole-app pinned-pass diverging colours | 0 | **0** |
| `gamut-sweep` offenders | 0 | **0** |
| `contrast-check` `--live-bright` on surface | 6.74 | **6.74** (unchanged — it already gated on the sRGB rendition) |

`--border-accent` (Δ2.9/255, ~1%) is deliberately left alone: it is below the visible
threshold and outside what was decided here.

## What is still open

Nothing in this repo. One field check remains: **confirm Tim's build is ≥ v0.2.14** before
judging any of this in the field — `1604d21` (the 2026-08-10 gamut work) is an ancestor of
v0.2.14 and v0.2.15, so an older build predates the whole colour system this document
describes, and the `--live-bright` fix above lands in the next release after it merges.

## Running these

```bash
node apps/web/scripts/engine-color-parity.mjs --verbose   # expression-level; no server needed
pnpm dev                                                  # then, in another shell:
node apps/web/scripts/engine-color-diff.mjs --base http://localhost:5173
```

Both need the Playwright WebKit engine: `node node_modules/playwright-core/cli.js install webkit`.
This is a dev-machine action, not a dependency — nothing was added to `package.json`.
