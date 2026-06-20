---
name: conventions
description: How code is written in this project — naming, structure, patterns, and style. Load when writing new code or reviewing existing code.
triggers:
  - "convention"
  - "pattern"
  - "naming"
  - "style"
  - "how should I"
  - "what's the right way"
edges:
  - target: context/architecture.md
    condition: when a convention depends on understanding the system structure
last_updated: 2026-06-20
---

# Conventions

## Naming
- Files: kebab-case (`pixel-model.ts`, `output-manager.ts`); Svelte components PascalCase (`OutputConfig.svelte`).
- Functions: camelCase, verb-first (`buildPixelModel`, `resolveParams`, `frameToUniverseBytes`).
- Effect ids: kebab-case string ids (`solid-base`, `radial-wash`) that double as registry keys and clip `effectId`s.
- Tests: colocated `*.test.ts` next to the unit they test.
- Svelte 5 runes state modules use the `.svelte.ts` extension (`app-store.svelte.ts`).

## Structure
- `packages/core` is pure — no `node:*`, no DOM, no IO imports. Geometry/model/effects/engine only.
- IO (UDP/Art-Net/sACN/OSC) lives in `packages/io` behind `PixelOutput`/`EventInput`; `core` never imports it.
- The zod schemas (`kit-schema.ts`, `project-schema.ts`) are the single source of truth — TS types are `z.infer`'d from them, never hand-duplicated.
- Effects are pure `render(ctx, params, fb, state)`; per-clip mutable state is engine-owned (`ClipState`), reset on clip change, never persisted.
- Server reducer is explicit + typed (`applyClientMessage`) — no generic path-mutation. The engine is the source of truth; the UI applies optimistically and reconciles on `state` echo.
- Relative imports are extensionless (Bundler resolution); type-only imports use `import type` (verbatimModuleSyntax).

## Patterns
- **Pure encoders, thin transports.** Protocol code splits a pure `encode*()` (byte-level tested) from a thin `dgram` sender. Example: `encodeArtDmx()` vs `ArtNetOutput`.
- **Float framebuffer, quantize once.** Effects/compositor work in `Float32Array` RGBA; bytes are produced only at the output/wire boundary (`toByte`, `frameToUniverseBytes`).
- **Replay determinism.** Effects are pure functions of `RenderContext`; randomness comes from a seeded `mulberry32` in engine-owned state. Two engines fed the same tick-stamped event log render identical frames.

## Verify Checklist
Before presenting any code:
- [ ] `packages/core` change added no `node:*` / DOM / IO import.
- [ ] New types are `z.infer`'d from a schema, not hand-written duplicates.
- [ ] Effects/render code stays pure (no wall-clock, no unseeded RNG, no hidden globals).
- [ ] New WS message is a typed member of the union with encode/decode + reducer handling (no generic mutation).
- [ ] `pnpm typecheck` and `pnpm test` are green; new behavior has a colocated test.
