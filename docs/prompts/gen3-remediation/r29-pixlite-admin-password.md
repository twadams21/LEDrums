# R29 — PixLite admin-password setting for authenticated controllers (GH #108)

Read first: `docs/prompts/gen3-remediation/CONVENTIONS.md`, then
`gh issue view 108 -R twadams21/LEDrums`, then the parent spec (Hardware
section, `docs/plans/2026-07-09-gen3-ux-remediation-spec.md`).

Controllers with a non-empty admin password can authenticate: an
admin-password setting flows from the settings UI through project
persistence to the PixLite transport (`packages/io`), which uses it when
talking to the controller. Empty password must behave exactly as today.

Respect the AGENTS.md seams: transport/auth logic lives in `packages/io`
behind its interfaces; `packages/core` stays IO-free; UI writes the setting
through the existing project-settings path (server `Project` is the source
of truth).

Deliverables include an IO-seam transport test for the authenticated path.
The real-hardware probe is a separate manual ticket (R28) — do not attempt
to reach real hardware.
