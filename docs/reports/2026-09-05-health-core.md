# Health P03 / P04 / P08 — core + offline runtime

Source: `docs/plans/2026-09-05-codebase-health-audit.md`; Trent's dispatch explicitly approves restart-on-geometry-edit and the follow-ups. Isolated worktree `ledrums-health-core`, branch `fix/health-core-runtime`, base `ea18f61`. No store/shows/persistence, global ROUTER/design artifact, output/IO or release changes.

## P03 — geometry ownership

`GeometryState` identifies an immutable `PixelModel` revision by object identity, not pixel count. `ensureGeometryState` resets generator/modifier state recursively for Mix and Splice members. The engine invalidates at `setModel`; the compositor also checks at render (including zero-level voices), so direct/offline adapters receive the same protection. Pool deactivation drops model references. State restarts lazily with the original seed; voice identity/age/envelope and splice motion/latches are preserved. A model edit is not a new trigger. Mutating a PixelModel in place is unsupported: supply a new object for a geometry revision.

Proof:
- `pnpm install --frozen-lockfile` (required locked install).
- Red: `pnpm --filter @ledrums/core exec vitest run src/voice/runtime-geometry.test.ts`: **9 failed / 3 passed**, stale buffers/non-finite feedback and fresh-state mismatches. The initial fixture validation failure was corrected before recording this red.
- Green: runtime geometry + compositor + Splice render + pool: **156 passed**. Matrix: Pixel Accumulation / Confetti × Feedback / Echo × ordinary / Mix / Splice; sequential grow/shrink/equal-total reorder compared with fresh-state rendering at the same voice age.
- Offline geometry regression: **1 passed**, same model-revision sequence through `Sim` + `renderFrame`.

## P04 / P08

Implementation and measurements pending in subsequent logical commits. No full sweeps, browser screenshots, hardware certification or publish actions are performed by this worker; integrated screenshots belong to the orchestrator.
