# Slice: gamut-safe colour tokens — explicit P3 with sRGB fallback

Requested by Trent (2026-08-10, this machine): the app "looks crap on Tim's laptop". Decision
locked with Trent: **P3 with sRGB fallback** — not an Electron/Chromium shell switch.

## The defect

The desktop shell renders in WKWebView (Safari's WebKit); development happens in Chromium. The
design system authors single `oklch()` values — 57 tokens in `apps/web/src/styles/tokens.css` —
and several (notably the phosphor-lime accent family, e.g. `--accent: oklch(0.845 0.190 128)`)
sit at or beyond the sRGB gamut edge. When a colour is out of gamut for the target display,
**each engine gamut-maps it its own way**, so WebKit and Chromium disagree, and the app's look
depends on which engine and which display renders it. There is currently zero gamut handling
(`color-gamut` / `display-p3` appear nowhere in the app).

## The fix (authoring both renditions, so no engine guesses)

For every colour token, author BOTH renditions explicitly:

```css
:root {
  /* sRGB rendition: CSS Color 4 gamut mapping (reduce OKLCH chroma until in gamut —
     hue and lightness held). NOT naive RGB channel clipping, which shifts hue. */
  --accent: <srgb-safe value>;
}
@media (color-gamut: p3) {
  :root {
    /* P3 rendition: the reference look — phosphor lime stays hot on P3 displays. */
    --accent: <display-p3 or in-P3-gamut oklch value>;
  }
}
```

- The **P3 rendition is the design intent** (what the OKLCH values mean today on a good display).
- The **sRGB rendition is the closest in-gamut match** via chroma reduction.
- Tokens already inside sRGB gamut may stay as plain `oklch()` — only out-of-gamut tokens need
  the pair. In-gamut `oklch()` renders identically in both engines.
- Alpha variants keep their alpha through conversion.

## Implementation constraints

1. **Generate, don't hand-convert.** Add a small node script (suggested:
   `apps/web/scripts/gamut-tokens.mjs`, using `culori` as a devDependency — it implements CSS
   Color 4 oklch gamut mapping) that reads the OKLCH source values and emits/verifies the paired
   blocks. Whether output is generated-in-place or checked by CI, the committed `tokens.css` must
   be the readable source of truth, each token's original OKLCH intent still visible (as the P3
   value or a comment).
2. **Parity check** (mutation-parity discipline): a test or check script asserting the
   `@media (color-gamut: p3)` block covers exactly the set of out-of-gamut tokens — no token can
   drift into one block and not the other. Wire it so `pnpm test` or `contrast-check` catches it.
3. **Sweep the strays.** 9 raw `oklch()` literals live outside tokens.css
   (LayersDock/Monitor/ControllerStatusPanel/Styleguide/TokenSwatch/resolve-color.ts/
   SectionSpaceShape). Route each through a token, or give it the same paired treatment if it is
   out of gamut. Styleguide files that *display* colour values (TokenSwatch, resolve-color) may
   legitimately keep literals — judge each.
4. `color-mix()` (108 usages) inherits fixed endpoints — no change needed unless a mix references
   a raw out-of-gamut literal. Verify, don't churn.
5. **Contrast must not regress:** `apps/web/scripts/contrast-check.mjs` gates AA on the resolved
   sRGB values — it must pass against the sRGB fallbacks (the rendition contrast actually
   degrades to).
6. Canvas/WebGL visualiser colours come from the engine's RGB pipeline — **out of scope**.

## Verification (all required)

- `pnpm typecheck` + `pnpm test` green; contrast-check passes.
- `pnpm design-system` regenerated in the same change (AGENTS.md rule — the tokens page shows
  browser-resolved sRGB readouts and will change).
- `pnpm ui-shot` captures of at least: trigger-graph, node-editor-play, patch-controller, and the
  styleguide token section — plus **one Safari-vs-Chrome comparison** of the same surface
  (Safari.app against the dev server reproduces Tim's WebKit rendering; screenshot both, eyeball
  that they now match).
- Apply `/make-interfaces-feel-better` judgment: the sRGB fallbacks should still read as the same
  design (graphite canvas, hot lime accent), just inside gamut.

## Ops notes

- You are in the worktree `../ledrums-color-tokens` on branch `feat/color-tokens-p3-srgb`. Run
  `pnpm install` before anything (fresh worktree).
- `pnpm ui-shot` probes `:5173` by default; if your dev server lands on another port, set
  `UI_SHOT_BASE` to it (known collision gotcha).
- `pnpm test` serialises via the repo test lock — normal, just slower if another sweep runs.

## Done

Committed on a branch, sweep green, pushed, **PR opened into main — do not merge it** (review
happens on the PR). Report: branch, PR number, which tokens got pairs vs stayed single, and the
Safari/Chrome shot pair.
