# Wave 2 — fine-grained pieces (S02 + S03 + S04 split for parallel agents)

Wave 2 runs as small, file-disjoint pieces, about 5 agents at a time. Each piece:

- implements its part of the parent slice doc (S02 / S03 / S04);
- in its own isolated worktree, on branch `feat/effect-chains-w2-<piece>`, off the S01 tip;
- inside the fence listed here, which overrides the parent doc's fence.

Every rule in `00-overview.md` applies. Do not edit `packages/core/src/index.ts` or any file
outside your fence; report any needed exports and the orchestrator adds them at merge. Since
other pieces land beside yours, depend only on S01 code and your own files.

| Piece | Parent doc section | Fence (may mutate) |
|---|---|---|
| `strobe` | S02 §2 Strobe | `packages/core/src/modifiers/impl/strobe.ts`, new strobe tests |
| `chain-mix` | S02 §1 chain runner mix + envelope | `packages/core/src/modifiers/chain.ts`, `modifiers/types.ts`, new chain tests |
| `blend` | S02 §3 compositor blend / opacity / order | `packages/core/src/voice/compositor.ts`, `voice/generator-bridge.ts`, new compositor tests |
| `master` | S02 §4 Master chain | new `packages/core/src/effect-chain/master.ts` + tests; `voice/engine.ts` (master stage + state ONLY, a minimal hook) |
| `gen-simple` | S03 §1–3 for kinds **solid, gradient, meter, lightning, scene** | `packages/core/src/effect-chain/generators/{solid,gradient,meter,lightning,scene}.ts` + tests |
| `gen-wave` | S03 §1–3 for kind **wave** (all its Styles) | `packages/core/src/effect-chain/generators/wave.ts` + tests |
| `gen-field` | S03 §1–3 for kinds **noise, particles, pattern** | `packages/core/src/effect-chain/generators/{noise,particles,pattern}.ts` + tests |
| `gen-merges` | S03 §2 merges (radial-wash collapse mode; whole-drum `hoopDelayMs` / "Simple") | `packages/core/src/effects/impl/radial-wash.ts`, `effects/impl/whole-drum.ts`, `effects/metadata.ts`, new effect tests |
| `gen-splice` | S03 §4 Splice / Slice generators | `packages/core/src/effect-chain/generators/{splice,slice}.ts`, `effect-chain/resolve-splice.ts` + tests |
| `library-server` | S04 §1, §2, §4 (core library builder, versions, server restore / archive / fireEffect) | `packages/core/src/effect-chain/library.ts` + tests, `model/library-versions.ts`, `apps/server/src/{project-show,project-storage,show-library,song-library,named-blob-store}.ts`, `handlers/client-message.ts`, `voice-engine-host.ts` (fireEffect routing), and their tests |
| `protocol` | S04 §3 protocol (`showSchema` effects / master; `fireEffect` message) | `packages/protocol/src/**` |

## Generator registry layout (set up by the orchestrator before the wave)

`effect-chain/generators/index.ts` aggregates one `GeneratorDef` per kind file. Each kind file
exists as a stub exporting its def with the S01 minimal Styles, or none. Generator pieces fill
their own kind files only.

- `gen-merges` supplies the radial-wash `collapse` mode and the whole-drum `hoopDelayMs` param.
  `gen-wave` / `gen-simple` reference them by param key. Style overlays that depend on a merge
  param must still typecheck and render if that param is absent; it is added in a sibling piece.
- `gen-splice` owns `resolve-splice.ts` and the splice / slice kind files. If the resolver needs a
  hook, report it instead of editing `resolver.ts`; the orchestrator wires it at merge.

## Report extras

List:

- required exports;
- `resolver.ts` hooks;
- cross-piece assumptions (for example "the Wave `collapse` Style expects radial-wash
  `mode: 'collapse'`").

The orchestrator merges all wave-2 branches into `feat/effect-chains-s02-wave2` and runs the
integration gates there.
