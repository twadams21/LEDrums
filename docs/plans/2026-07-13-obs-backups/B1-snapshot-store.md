# B1 — SnapshotStore: bundle, triggers, retention

Spec: #123. Effort: **high** (novel seam). Wave 3 — after E2 is merged (shares boot wiring; no functional dependency on E2).

## Mission

One new server module, the **SnapshotStore**: point-in-time gzipped bundles of the three persisted blobs (project, show library, song library), taken on boot / cadence / pre-risk triggers, rotated locally. After this slice the drummer's work is recoverable on disk — before any UI or off-site push exists.

## What to build

1. **SnapshotStore factory** (new `apps/server/src/snapshot-store.ts` + test) over injected paths + clock:
   - `snapshot(reason)`: bundle `{version: 1, createdAt, reason, files: {project, shows, songs}}` → gzip → atomic write to `projects/backups/<ISO-timestamp>-<reason>.json.gz`. Blobs captured exactly as persisted (read the current in-memory state through the same serializers the autosave paths use — not by re-reading files, which could be mid-write).
   - `list()`: id, createdAt, reason, size.
   - `readBundle(id)` + `restoreFiles(id)`: atomically replace all three blobs on disk from a bundle. **Mechanics only** — engine reload/broadcast orchestration is B2's.
   - **Rotation** on every write: keep the 48 most recent, plus one per day for 30 days, plus the 20 most recent `pre-risk` on their own budget regardless of age.
2. **Triggers**:
   - **Boot**: one snapshot before any mutation is possible (immediately after the blobs load).
   - **Cadence**: every 30 minutes, gated by a content hash over the three blobs — unchanged content takes no snapshot. Timer must not keep the process alive (`unref`, like the autosaver).
   - **Pre-risk**: an exported `snapshotPreRisk(reason)` hook, called synchronously-before-mutation from (a) the bulk `setProject` apply path and (b) any persisted-schema migration site found while wiring. The trigger list is **append-only** — future whole-blob writers must call it.
3. **Binary atomic write**: the existing atomic helper is utf8-text; add a Buffer variant beside it (additive).

## Anchors to verify

- `apps/server/src/atomic-file.ts` — extend additively for Buffers.
- `apps/server/src/projects.ts`, `show-library.ts`, `song-library.ts` — how each blob serializes and where its file lives; the bundle must capture the same bytes the autosavers would write.
- `apps/server/src/autosave.ts` — the factory/injection style and the `unref` timer pattern.
- `apps/server/src/handlers/client-message.ts` — the `setProject` apply path (routing-integrity gate landed ~PR #121; the pre-risk call sits with it, before mutation).
- `apps/server/src/boot.ts` / `main.ts` — blob-load order, to place the boot snapshot correctly.

## Scope fence

May touch: new `snapshot-store.ts`(+test), `atomic-file.ts` (additive Buffer variant), `boot.ts`/`main.ts` (trigger wiring), `client-message.ts` (the one pre-risk call), tests.
Non-goals: no WS messages, no UI, no restore orchestration/broadcast (B2), no off-site push (B3), no protocol changes.

## Tests

Temp dirs + fake clock, external behaviour only: bundle round-trip (snapshot → restoreFiles reproduces all three blobs byte-for-byte), hash gating (no change → no snapshot), reason stamping, the full retention matrix (48-window edge, daily thinning, pre-risk separate budget, interleaved reasons), restore atomicity (a failed restore leaves current files intact), boot-trigger ordering, `setProject` → pre-risk snapshot exists before the mutation applied. Prior art: `autosave.test.ts`, `named-blob-store.ts` tests, `atomic-file` usage.

## Escalation triggers

- The three blobs can't be captured coherently at one instant (e.g. a serializer only exists behind a debounced write) — propose the seam change, don't approximate.
- The `setProject` path's shape makes "snapshot strictly before mutation" ambiguous (partial applies, validation-then-apply gaps).
- Any second whole-blob mutation path discovered beyond `setProject`/migrations — add it to the trigger list and say so in the report.
