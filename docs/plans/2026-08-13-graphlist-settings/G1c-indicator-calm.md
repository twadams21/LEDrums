# G1c — Fire indicator: calm it down

**From Trent on the live preview, 2026-08-13:** "The graph indicator is too intense — I don't
like the border animation or glow — just leave the indicator and reduce the decay to 150ms
(use a token)."

**Base:** `feat/graph-list-177` at `2bf9536` (your worktree). New commit, push updates PR #179.

## Exactly this

- **Remove** the impact ring (`.gfire::before` border animation) and the glow/wash layer
  (`.gburst` — the radial wash, the halo box-shadows, all of it).
- **Keep** only the left-edge fire marker (`.gfire::after`), with its decay reduced from 6s
  to **150ms**, the duration coming from a **token** — use an existing duration token if one
  fits (`--dur-*` family in `apps/web/src/styles/tokens.css`) or add `--dur-150` beside its
  siblings (tokens.css addition explicitly allowed for this one token; follow the existing
  naming/format exactly).
- Rapid re-fires still restart the marker (`{#key}` on the fire epoch stays).
- Simplify what this leaves behind: the `.gslot` wrapper may stay (harmless, and the marker
  still needs to not be clipped… verify whether it is — the marker sits INSIDE the card
  bounds, so if the wrapper is now unnecessary, remove it rather than leave scaffolding).
  Reduced-motion block: with no moving layers left, prune it to whatever still applies.
- Update the component comment + the graph-fire test if it asserts removed layers, and the
  shot set (re-shoot the burst shots — they'll now show the marker only).

Gates + report as G1b: green on committed HEAD, push via twux push, one-line report with sha.
I re-merge into the preview.
