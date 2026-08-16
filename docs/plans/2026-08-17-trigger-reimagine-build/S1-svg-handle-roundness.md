# S1 — Envelope editor SVG handles render as ellipses (fix (b): px-true viewBox)

**Effort: opus/medium · branch `fix/envelope-handle-roundness` off `main` · PR into main.**

## The bug (verified, cosmetic only)

`apps/web/src/lib/**/EnvelopeEditorView.svelte` (~line 197) renders its plot with
`viewBox="0 0 480 160"`, `preserveAspectRatio="none"`, CSS `width:100%; height:160px` — the only
`preserveAspectRatio="none"` in `apps/web/src`. y-scale is always 1; x-scale is
`renderedWidth/480`. Every circular handle becomes an ellipse by that ratio. In the
`EnvelopeNodeInspector` drawer at its 320px default the squash is ~33% (r=7 dot → 9.3×14px);
in the `EnvelopeEditor` modal (~488px) it's ~2%.

Drag correctness is unaffected: `toUnit()` in `envelope-editor-geom.ts` divides by `rect.width`.

## The fix — (b), the right one

Measure the rendered box width and set the viewBox width to it, so 1 SVG unit = 1 CSS px:
plot fills the width, handles stay round, hit-circle radii become honest pixels. Height stays
160. Use a resize observer (or Svelte `bind:clientWidth`) — the drawer is user-resizable
280–460px, so the viewBox must track live resizes.

`GEO.W` is a fixed export consumed by `envelope-editor-geom.test.ts` — geometry becomes
width-parameterised. Update the module honestly (width as an argument or a documented default),
keep the tests meaningful (test at two widths, not just the old constant). Do NOT weaken
assertions to make them pass (`/honest-tests`).

## Anchors to verify before building

- `EnvelopeEditorView.svelte` — the single `preserveAspectRatio="none"` site.
- `envelope-editor-geom.ts` + its test — how `GEO.W` flows into point mapping.
- Both consumers: `EnvelopeEditor.svelte` (modal) and `EnvelopeNodeInspector.svelte` (drawer).

## Scope fence

May touch: `EnvelopeEditorView.svelte`, `envelope-editor-geom.ts`, `envelope-editor-geom.test.ts`,
and the two consumers ONLY if a prop must thread through. Non-goals: any visual redesign, the new
S6 envelope param control, design-system changes (this is not a styleguide component change —
regen only if the styleguide actually renders this view).

## Evidence

- `pnpm typecheck` 0; targeted vitest for envelope-editor-geom green. **Do NOT run the full
  `pnpm test` sweep — orchestrator-only rule (parallel sweeps can crash this machine); the
  orchestrator sweeps at review.**
- ui-shot of the envelope node inspector at default drawer width showing round handles
  (there are existing envelope-related presets in `scripts/ui-shot/shots.json`; add one if none
  captures the drawer case).
- Report: commit body <30 lines; message names sha + branch.

## Escalate if

- Fix requires changing public exports of `envelope-editor-geom` consumed beyond the two
  consumers listed.
- The resize-driven viewBox causes visible reflow jank (then propose fix (a) as fallback with a
  screenshot comparison — do not silently downgrade).
