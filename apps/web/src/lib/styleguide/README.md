# LEDrums design system — living styleguide + single-file artifact

One source, two outputs:

- **Live route** — `pnpm dev`, open `http://localhost:5173/?style`. Hot-reloads as
  components change.
- **Artifact** — `pnpm design-system` (repo root) builds `docs/design-system.html`:
  one self-contained HTML file (JS, CSS and the Geist fonts inlined) that opens
  straight from the filesystem, offline. Commit the regenerated file with the
  change that touched the UI.

Both mount `Styleguide.svelte`. The demos import the **real** components from
`lib/ui` / `lib/app` / `lib/trigger-lab` — the artifact is generated from them by
`vite.design-system.config.ts` (entry `apps/web/design-system.html` →
`src/design-system.ts`), so it cannot drift from the app: regenerating after a
component change reflects it by construction.

## Source pointers

Every demo card and token swatch has a ⧉ click-to-copy chip. Token chips copy the
CSS var name; demo chips copy the component's repo-relative source path. Paths
resolve through `virtual:source-manifest`, generated at build time from the real
filesystem by `scripts/vite-plugin-source-manifest.mjs` (keys = src-relative paths
without extension, e.g. `lib/ui/Splitter`). A stale key renders as a visible
`⚠ missing` chip — pointers are never hand-maintained.

## Extending (the contract for UI work)

Any UI-touching change must compose from the system — or extend it:

1. Build the new thing on the tokens + primitives shown here.
2. If it's reusable, add it to `lib/ui` (or the relevant composite home) and demo
   it in the matching `sections/Section*.svelte`.
3. Regenerate: `pnpm design-system`, and commit `docs/design-system.html` in the
   same change.

Store-bound composites are demoed through minimal reactive stubs (see
`sections/SectionComposites.svelte`) — the stub feeds the real component; never
copy component markup into the styleguide.
