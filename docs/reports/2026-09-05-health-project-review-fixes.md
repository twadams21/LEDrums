# P02 — four frozen-review blockers

**Next:** independently re-review the owned-only commit on `fix/health-integration`.
**Status:** locally fixed and targeted gates green; no push, PR, merge, deploy or release.

## Sources and ownership

- Trent's in-session request, on Trent's MacBook Pro (`scutil --get ComputerName`).
- Original implementation/limits: `docs/reports/2026-09-05-health-projects.md`.
- Frozen `96909f7f` review: `/tmp/ledrums-review-96909f7f-4827-final.log`, five failing probes covering four independent findings (shutdown reproduced in both modes).
- This work started at integrated `dd718051`, which includes `ead799ed` and later runtime/state repair `e5543b1d`. No rollback or replacement of later core changes.
- Worktree: `/Users/trent/Documents/dev/ledrums-health-build`. Owned: boot/main lifecycle, named project IO, library projection/replacement validation, regressions, minimal pure shared adapters and this report/scaffold notes.
- sa33's dirty SnapshotStore/worker files and sa29's checkpoint/modifier files were not edited or staged. Existing sa33 hunks in `main.integration.test.ts` (optional SEA launch) and `project-replacement.test.ts` (worker cleanup/admission) were preserved in the worktree but excluded from this commit. Tests ran against the combined working tree, not a claim that this commit independently verifies the unfinished P11 work. UI work remains separate.

## Changes and semantic boundaries

### 1. Shutdown admission is distinct from client teardown

`boot.ts` stops frame/input loops and listening immediately, but closes existing WS clients **after** the operations barrier. `WebSocketServer.close()` stops admission without closing those clients. `main.ts` rejects shutdown-time connections and messages before decoding/monitoring, in addition to the existing dispatch/OSC guards.

Client close/error during the shutdown drain (including a peer disconnect or tunnel teardown) no longer removes the editor identity until accepted authoring settles. Outside shutdown, close/error removal and the handler's execution-time authorization check are unchanged. A takeover before shutdown still revokes queued work; no shutdown-only unconditional authorization bypass was added. A takeover arriving after shutdown cannot change the frozen identity.

The final output stop/await remains after authoring, preserving the later repair for a queued output edit that reopens an adapter. Client teardown still runs if the disk/operations drain fails. This is graceful SIGTERM/SIGINT behavior, not protection against SIGKILL, process crash, power loss, an indefinitely blocked filesystem, or guaranteed UDP receipt. No new global shutdown timeout or fsync promise.

### 2. Internal envelope filenames cannot be named Projects

`projects.ts` shares one case-insensitive reserved-name predicate across sync/async save, load/path lookup and listing. Reserved stems are `default.state.local`, `default.shows.local` and `default.songs.local`; none is a bare Project. Validation precedes filesystem IO, so safety does not depend on Linux case-sensitive fixtures or macOS case aliases.

`default.local` remains the legacy **bare Project** import slot used by existing boot recovery; it is not an envelope carrying libraries. Normal named project spelling and sorting remain unchanged. This change is not a symlink/hostile-local-filesystem sandbox.

### 3. Restored canvas voices use canonical parameter specs

The old synthesized `params: []` made core modulation skip brightness because it could not find the target spec. New pure `canvas/voice-definition.ts` builds canvas voice effects and default presets from `CANVAS_PARAM_SPEC`. Browser `store/canvas-scenes.ts` and server projection both call it. The existing total generator-to-voice parameter mapper moved verbatim in behavior from web fixtures into pure `effects/voice-param-spec.ts`; fixtures retain their old export as an adapter. Browser-only card metadata stays in the web adapter.

The server now carries parameter ranges, defaults, units and envelope eligibility, not just default preset values. No compositor, checkpoint, modifier, registry-rendering, DOM or IO implementation changed. Existing explicitly persisted effect definitions are still preserved; the fix concerns the virtual definitions synthesized for canvas scenes, matching the reviewed defect.

### 4. Versions fail closed before replacement safety/persistence

Chosen option: **reject unsupported versions**, not a second server migration pipeline. Current accepted envelope identities are exactly **show v2** and **song v1**; null library slots remain valid. Missing, string, fractional, non-finite, old and future versions fail. Both slots are checked even when no active show exists or the show map is empty. Replacement validation executes before safety snapshot, persistence or live pointer commit, in both engine modes. The production main library setters reject unsupported pushes before slot assignment/autosave/relay, and both boot paths validate recovered/imported libraries before their boot snapshot. Load/patch preserving existing libraries use the same gate.

`model/library-versions.ts` is the pure shared identity source; browser persistence imports/re-exports these constants, preserving its API and its existing v1→v2 show migration. No competing library schema was added. The existing protocol Show gate remains responsible for runtime shape validation. Current v2 `kick#1` remains `kick#1`; old v1 is never silently interpreted as current.

**Limits:** this is not the browser's full hydration/migration pipeline. It does not add full schema validation to every opaque library push or validate all inactive authored show content. The existing live `setShowLibrary`/`setSongLibrary` transport remains an opaque storage/relay boundary **after** its production version check. Unknown formats are refused, not repaired by guessing.

## Recovery for a refused older library

No live data was migrated in this task. Recovery must be performed on copies, with output disabled:

1. Preserve the original backup and all live-state/import files unchanged. Work in isolated temporary storage, never by deleting the authoritative envelope to expose stale imports.
2. For a **show v1** copy, use the existing pure browser pipeline in `apps/web/src/lib/trigger-lab/persistence.ts`: `deserializeShowLibrary(copy)` → inspect the result → `serializeShowLibrary(result)`. Abort if deserialize returns null. This performs the canonical hoop migration (`kick#0` → `kick#1`) before stamping v2. **Changing only `version` is not migration.** Compare shows/graphs/targets with the original because browser deserialization may drop malformed entries.
3. For song v1, use its existing deserialize/serialize pair if normalization is needed. No unsupported song-version migrator exists here. For unknown/future versions, use the originating compatible application/export path or a separately reviewed migration; do not relabel them v1.
4. Validate a copied coherent bundle in an isolated server before replacing live data through the supported restore path. A machine whose atomic authority is already unsupported may fail startup; preserve that authority and recover externally rather than relying on a browser connecting to the failed process. No one-click recovery UI/tool is claimed by this change.

## Verification

### Red evidence

`pnpm --filter @ledrums/server exec vitest run src/boot.test.ts src/projects.test.ts src/project-show.test.ts src/project-replacement.test.ts src/main.integration.test.ts`

`/tmp/p02-review-fixes-red.log`: **30 failed / 35 passed**. This includes two explicitly excluded harness failures: an incorrect new canvas test constructor argument, and one ephemeral-port EADDRINUSE. The corrected frame probe was rerun before the fix:

`pnpm --filter @ledrums/server exec vitest run src/project-show.test.ts -t 'restores canvas'`

`/tmp/p02-canvas-red.log`: CC 0 peak RGB **0.9961438775**, expected **0**. The original red real-main tests in both modes exited 0 with persisted `showLibrary: null` instead of the queued v2 edit. Boot ordering closed the client before drain; case-variant and version gates failed their specific assertions.

### Final targeted gates (all exit 0)

```sh
pnpm --filter @ledrums/server typecheck
pnpm --filter @ledrums/core typecheck
pnpm --filter @ledrums/server exec vitest run \
  src/boot.test.ts src/projects.test.ts src/project-show.test.ts \
  src/project-replacement.test.ts src/main.integration.test.ts \
  src/handlers/projects.test.ts src/handlers/client-message.test.ts src/project-storage.test.ts
pnpm --filter @ledrums/core exec vitest run \
  src/canvas/voice-definition.test.ts src/canvas/scene.test.ts
pnpm --filter @ledrums/web exec vitest run \
  src/lib/trigger-lab/fixtures.map-param-spec.test.ts \
  src/lib/trigger-lab/store/canvas-scenes.test.ts \
  src/lib/trigger-lab/show-builder.canvas-scenes.test.ts \
  src/lib/trigger-lab/persistence.hoop-migration.test.ts \
  src/lib/trigger-lab/persistence.songlibrary.test.ts src/lib/trigger-lab/persistence.test.ts
```

- **133 server tests / 8 files**, `/tmp/p02-review-fixes-final-tests.log`.
- **9 core canvas tests / 2 files**.
- **88 pure web-adapter tests / 6 files**, `/tmp/p02-web-adapters.log`.
- Server/core package typechecks; web **pure adapter-only** `tsc --noEmit`, using a temporary config extending `apps/web/tsconfig.json` with `include` limited to fixtures, persistence and store/canvas-scenes. Temporary config removed after success. No full web/Svelte check claimed.
- `git diff --check` clean.

The actual-main fixture uses FIFO named-load IO, an open-writer handshake and wire-ordered ping to establish admission **before** SIGTERM, then waits for the listening port to close before submitting late edits/takeover. Both modes cover connected editor and peer-disconnect variants, verify accepted library persistence and cold restart, reject a late output edit, and independently prove ordinary takeover revokes a queued edit. Both modes also reject old show/future song pushes before those blobs enter live storage. FIFO tests skip Windows (no portable mkfifo there); boot ordering and name validation are platform-independent. All subprocesses use temp storage, fresh loopback ports, disabled pixel output, broadcast false and an allowlisted environment with telemetry off. The optional SEA fixture supplied by sa33 was preserved but not enabled here.

The real VoiceEngineHost canvas test advances in 5 ms ticks and asserts CC1=0 yields exactly dark RGB, then CC1=127 yields peak >0.9, with one live voice. Core tests pin every spec field/default and independent mutable definitions. Existing browser mapper and hoop migration tests confirm the extraction did not change web semantics.

## Conventions / exclusions

1. Pure core: **PASS** — only format constants and pure builders/mapping; no Node/DOM/IO or hidden time/randomness.
2. Canonical models: **PASS** — existing EffectDef/ParamSpec/CanvasScene types and protocol Show schema; no competing library schema.
3. Wire/auth behavior: **PASS** — no new wire discriminant; existing handler execution-time takeover checks retained and exercised.
4. Targeted tests/typechecks: **PASS** as listed; no full sweep, dependency install/change, SEA build, hardware or live storage access.
5. UI: **not touched** — only pure web data adapters/constant re-exports. No component, CSS, interaction or styleguide surface changed; no UI-shot/design-system claim. Release, remote services and deployment are unexecuted.
