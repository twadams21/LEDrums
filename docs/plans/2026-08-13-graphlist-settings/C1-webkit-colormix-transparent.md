# C1 — WebKit colour divergence: color-mix(in oklch, …, transparent)

**Source:** Trent, 2026-08-13 (this machine), diagnosing why the app's colours are wrong on
Tim's Mac (desktop app = WKWebView): every `color-mix(in oklch, var(--x) N%, transparent)`
(and similar) renders differently in WebKit than in Chrome. This is the likely remaining
cause after the 2026-08-10 gamut work (`feat/color-tokens-p3-srgb`) fixed the P3/sRGB side.

**Base:** branch off `origin/main` (`git checkout -b fix/webkit-colormix-transparent
origin/main`). PR targets `main`. This is a shipped-app bug — it must not wait on the
tabbed-chrome stack.

## The mechanism (verify, then fix)

`transparent` ≡ `rgba(0,0,0,0)` — transparent BLACK. Mixing toward it in a cylindrical space
(oklch) is spec'd as premultiplied-alpha interpolation with carried-forward missing
components, but WebKit resolves the transparent endpoint's lightness/hue differently from
Chromium, so the result shifts toward black/grey and can rotate hue — only in WebKit. First
REPRODUCE it: render a swatch of one offending mix in Playwright's chromium AND webkit
engines (`npx playwright install webkit` if needed; playwright-core is already a repo dep via
ui-shot) and screenshot both — pixel-sample the difference. That reproduction is also your
acceptance harness.

## The fix pattern

Where the intent is "colour X at N% alpha" (every mix whose other endpoint is `transparent`):

    color-mix(in oklch, var(--x) 55%, transparent)  →  oklch(from var(--x) l c h / 55%)

Relative colour syntax applies alpha with NO interpolation — identical in both engines,
preserves the token's exact colour, keeps chroma so gamut status is inherited from the base
token (which the gamut pipeline already manages). Do NOT switch these to `in srgb` mixes
(that changes the rendered colour) and do NOT change mixes whose endpoints are both opaque
(e.g. the `--sec-wash` accent/surface blends) — those are correct and audited; this slice is
ONLY the transparent-endpoint cases.

## Sweep scope (find every case — grep is your inventory, name the count in the report)

- All CSS: `apps/web/src/styles/*.css`, `apps/web/src/app.css`, component `<style>` blocks in
  `.svelte` files.
- Runtime-built colour strings: `apps/web/src/lib/ui/oklch-gamut.ts` consumers, LayersDock
  voice tints, anywhere `color-mix` appears in `.ts`/`.svelte` script code.
- `docs/design-system.html` is generated — regen, don't edit.

## Tooling is in scope (and is the real risk)

`apps/web/scripts/color-mix-audit.mjs` statically parses every color-mix; `gamut-tokens.mjs`
and `contrast-check.mjs` gate the palette; `src/styles/tokens-gamut.test.ts` locks parity.
After the rewrite these must still pass MEANINGFULLY: the audit must either understand
`oklch(from … / a)` (alpha-only relative colours are in-gamut iff their base token is — a
sound static rule) or explicitly account for them — a silent skip that greens the sweep while
checking nothing is a defect, not a pass. If a script needs extension, extend it in the same
change with tests. `pnpm --filter @ledrums/web gamut-sweep` must stay 0-offenders.

## Acceptance

1. Playwright chromium-vs-webkit swatch comparison: before = divergent, after = matching (to
   within antialiasing noise) for a representative sample of rewritten sites. Include the
   numbers (sampled RGB per engine) in the report.
2. Full sweep green on committed HEAD (test/typecheck/gamut-sweep/contrast).
3. ui-shot pass over main surfaces — the app should look UNCHANGED in Chrome (alpha
   application ≈ what the oklch mix produced there; if any site visibly shifts in Chrome,
   flag it in the report with a shot).

## Fence

May mutate: the CSS/svelte-style/ts colour sites above, `apps/web/scripts/`
(audit/gamut/contrast tooling + tests), tokens.css ONLY if a mix lives there,
styleguide + design-system regen if styleguide entries carry offending mixes, ui-shot presets.
Non-goals: any layout/markup change, the tabbed-chrome branches (this is main), engine/
server/protocol. Discipline per house rules (no new deps — playwright webkit engine install
is a dev-machine action, not a dependency; tokens only; comments only for constraints).

## Report

Commit body <30 lines: mechanism confirmed (with the sampled numbers), sites rewritten
(count), tooling changes, anything that visibly changed in Chrome. One-line SendMessage to
the orchestrator with sha + PR number + gates. Escalate: any transparent-mix whose intent is
NOT "base at N% alpha" (a real crossfade to nothing), or audit architecture that can't
soundly classify relative colours.
