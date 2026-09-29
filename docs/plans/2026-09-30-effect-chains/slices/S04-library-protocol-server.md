# S04 — v3 library format, runtime Show builder, protocol, server

Read first: `00-overview.md`, then the spec section "Persistence, files and import" and user
stories 66–71.

Builds on S01 (the Effect types and schema in `packages/core/src/effect-chain/`).

## Goal

A single pure core function builds the runtime `Show` from the new (v3) authored library.

- The server's cold-start restore uses it; the web's show-builder switches to it in S05.
- The protocol carries the new section shape.
- The server accepts v3 libraries while still restoring v2 (the graph path, expand-contract).
- Old blobs are archived, never destroyed.
- A `fireEffect` client message reaches the engine.

## Build

1. **`packages/core/src/effect-chain/library.ts`** (pure).
   - **Types + zod** for the v3 persisted show library and song library.
     - `ShowLibraryV3 = { version: 3, data: { shows: Record<id, { id, name, authored: AuthoredV3 }>, activeShowId } }`.
     - `AuthoredV3` holds the fields the runtime needs: `songs` (sections carrying `effects[]`,
       `master[]`, `bars?`, `bpm?`), `songRefs`, `canvasScenes`, `activeSongId`,
       `activeSectionId`, `bpm`, `beatsPerBar`, and `mappings?` (opaque passthrough until S07a).
     - Unknown fields are preserved (passthrough).
     - `SongLibraryV2 = { version: 2, data: { songs: Record<id, LibrarySongV3> } }`, where a
       library song is `{ id, name, sections(with effects / master), canvasScenes? }`.
   - **`buildRuntimeShow(showLib, songLib) → Show | null`.**
     - Selects the active show and materialises library-referenced songs, matching today's
       `lib:<songId>/…` re-keying policy for anything id-keyed.
     - Emits `songs → sections` with `effects` / `master`, plus `canvasScenes` and their
       EffectDefs (as `showFromLibraries` does today for scenes).
     - Legacy `graphs` / `buses` / `presets` / `sections` (looks) are empty. Effect ids are unique
       per section.
     - Validates via the Effect schema and drops invalid Effects with a diagnostic list returned
       alongside. Never throw for a bad Effect.
2. **Versions** (`model/library-versions.ts`). Add `SHOWS_VERSION_EFFECTS = 3` and
   `SONGS_VERSION_EFFECTS = 2`. Keep the existing constants (the web still writes v2 until S05;
   S08 retires them).
3. **Protocol** (`packages/protocol/src/schemas.ts`).
   - `showSchema` accepts songs whose sections carry `effects` / `master` (shape-gate them with the
     Effect schema from core, or a passthrough shape matching today's graph-node policy; state
     which).
   - A new client message `{ t: 'fireEffect', effectId }` is authorised like `fireGraph`: viewers
     may fire in the active section only, following the existing rule.
4. **Server.**
   - `project-show.ts` restore: version 3 → `buildRuntimeShow`; version 2 → the existing graph
     path, unchanged; any other version → today's fail-closed error.
   - Library storage: when a newer-version library blob replaces a stored older-version blob, the
     server first writes a one-time archive copy next to it (for example
     `default.shows.v2.local.json`) and never overwrites an existing archive. The same applies to
     the song library.
   - On cold start with only an unsupported / old blob that cannot be built, the server boots with
     an empty show and keeps the blob. Verify today's behaviour first and preserve its safety
     intent.
   - `fireEffect` handling routes to the engine's `fireEffect` input (S01), mirroring `fireGraph`
     in `handlers/client-message.ts` / `voice-engine-host.ts`.

## Anchors to verify first

- `apps/server/src/project-show.ts` (`validateLibraryVersions`, `showFromLibraries`,
  `selectionFromLibrary`).
- `project-storage.ts`, `show-library.ts`, `song-library.ts`, `named-blob-store.ts`.
- `packages/core/src/model/library-versions.ts`.
- Web `apps/web/src/lib/trigger-lab/persistence.ts` (`ShowLibrary` / `AuthoredState` /
  `SongLibrary` shapes, to mirror field names).
- Protocol `showSchema` and the `fireGraph` client message and handler.
- The S01 `effect-chain` schema.

## Scope fence

- `packages/core/src/effect-chain/library.ts` (+ test), `packages/core/src/model/library-versions.ts`
- `packages/protocol/src/**`
- `apps/server/src/project-show.ts`, `project-storage.ts`, `show-library.ts`, `song-library.ts`,
  `named-blob-store.ts`, `handlers/client-message.ts`, `voice-engine-host.ts` (fireEffect routing
  only), and their tests

**Do NOT edit:** `apps/web/**`, `effect-chain/resolver.ts` / `generators.ts`, `voice/**`,
`modifiers/**`, or `index.ts` (report exports).

## Acceptance

- `buildRuntimeShow` on a fixture v3 library (2 songs, one of them library-referenced, sections
  with effects and master, one scene) yields the expected Show. An invalid Effect is dropped with
  a diagnostic.
- The server restores a v3 library into a running engine and a zone hit renders (host seam test).
  A v2 fixture still restores exactly as before (existing tests untouched).
- Replacing a stored v2 blob with v3 writes an archive exactly once; an existing archive is never
  overwritten.
- `fireEffect` from an editor fires; from a viewer it follows the active-section rule.
- Gates: typecheck, targeted vitest (protocol, server, effect-chain), dead-code.
