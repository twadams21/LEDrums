# R25 — Live signal previews in the Random/Note/OSC inspectors (GH #104)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 104 -R twadams21/LEDrums`, then the parent spec's Phase 5.1
(`docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

The Random, Note, and OSC modulation-source inspectors show live signal
previews — Random's distribution curve, Note's gate/velocity, OSC's live
value — reusing the existing node-face signal-preview component (the way
the Scope inspector shows its hoops). Respect reduced motion via the
existing thumb-ticker behaviour.

Inspector code lives under `apps/web/src/lib/app/docks/inspectors/`.

UI work: `/make-interfaces-feel-better`, ui-shot per inspector, design
system regenerated if the styleguide gains entries.

Sibling note: R26 (Field-primitive migration) and R27 (protected-anchor
headers) are queued behind you in the inspectors area — don't migrate label
rows or touch the Output/Trigger kind-selector treatment.
