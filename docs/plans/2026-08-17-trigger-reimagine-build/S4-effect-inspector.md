# S4 — Effect inspector: progressive disclosure + filter (winner: option 4)

**Effort: opus/medium · branch `feat/effect-inspector-disclosure` off S3's branch tip (it
renders inside S3's drawer) · PR into main (stacks above S3).** Visual reference:
`docs/proto/trigger-effect-inspector.html` option 4 on `proto/trigger-reimagine` @ `e06b726`.

## The verdict (doc §3)

One list, no modes: **common params always visible at the top**, the effect's own params in a
**fold that remembers its state** (per session is fine; verify if a persistence convention
exists), and a **filter box** narrowing both sections. Trent: "go with 4".

Carry the prototype's key finding: option 4 is the only winner that degrades correctly
WITHOUT a core param-key rename. The common section must render **whatever the generator
actually declares** — bind by declared keys, never by assuming `hue`: Confetti Burst is
`baseHue`+`hueSpan`, Temp Sweep is `warmHue`, decay/life is spelled four ways (`decayMs`,
`lifeMs`, `lifeBeats`, `life`). Family-match keys for *grouping into* the common section
(colour-family, life-family, speed-family, level) but render each param under its own real
key and control. A param matching no family goes in the effect-specific fold. Nothing may
silently vanish: common ∪ fold = exactly the declared param set (assert this in a test).

## Interplay

- If S6b has landed on its branch by integration time, the life-family row in the common
  section is the bound `CurveField` (S6b defines seeding/detach); otherwise leave the scalar
  rows — S6b will replace them on its own branch. Coordinate through the orchestrator, not by
  reading S6b's worktree.
- S5 (face params) touches `ModulationParamsSection`/`TriggerNode` — NOT yours. If your
  layout work collides with `ModulationParamsSection`'s mounting, stop and report; the fence
  is drawn so you shouldn't.

## Anchors to verify

- The current effect inspector pane (post-#176/#179 world — find it fresh, don't trust old
  paths), how params render today (G3 primitives: TypeChip/ListHead, wheel-adjust fields).
- Effect param metadata: `packages/core/src/effects/metadata.ts` / registry declarations —
  the declared-params source of truth the assertion tests against.
- S3's drawer component (your parent surface) — its width regime and scroll behaviour.
- `SearchField` (gained `autofocus` in G1) for the filter box.

## Scope fence

May touch: the effect-inspector pane component(s) + new common-section/fold/filter
subcomponents, their tests, ui-shot presets, styleguide entry + regen for any new reusable
primitive. Non-goals: param-key normalisation in core (that is S7, backlog), TriggerNode,
ModulationParamsSection, the drawer shell itself, any core/protocol change.

## Evidence

- Typecheck 0 + targeted vitest (the inspector components + completeness assertion),
  committed HEAD pushed. **Do NOT run the full `pnpm test` sweep — orchestrator-only rule;
  the orchestrator sweeps at review.**
- The completeness assertion: for EVERY registered effect, common ∪ fold keys === declared
  keys (a loop over the registry in one test).
- ui-shot: two contrasting effects (e.g. comet + confetti-burst) showing what stays put vs
  changes; filter active shot — `--strict`.
- Report: commit body <30 lines; one-line completion message with sha + branch.

## Escalate if

- Family grouping is genuinely ambiguous for a param (name it, propose, continue with it in
  the fold — the fold is always safe).
- The fold-state memory wants a new persistence surface.
