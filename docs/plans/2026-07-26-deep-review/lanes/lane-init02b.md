# Lane: INIT-02 chunk 02B — sections + shows migrations (S6–S13)

Read `lanes/COMMON.md` and the **Chunk 02B** section of `lanes/init02-chunks.md` —
both bind. Branch: `init/02b-migrations` off `review/impl` (02A merged: ratchet
live at 364 members / 3431 LOC in store.surface.test.ts — it is your arbiter;
tighten both caps at every delete step. Re-measure baseline at your starting
HEAD, expect ~3175). Steps from `09-synthesis/INIT-02-store-decomposition.json`:
S6→S7→S8→S9 (arrangement), then S10→S11→S12→S13 (library), STRICTLY in order.

ANCHOR WARNING: plan line numbers predate INIT-01 and 02A — verify every symbol
against the real store.svelte.ts before editing. Forwarder/consumer counts are
measured claims: re-measure at your HEAD and report your numbers.

- S6: publish SectionsController as `readonly arrangement` (additive — the 18
  section forwarders STAY and keep forwarding). `git diff --name-only` for this
  commit must list only store.svelte.ts + store.surface.test.ts (ratchet gains
  +1 member).
- S7: retarget the store's internal uses + production consumers to
  `this.arrangement.*` / `store.arrangement.*`; forwarders still alive, tests
  untouched.
- S8: retarget the ~97 test hits (store.sections/looks/echo-gate/songs/graphs +
  setlist.test.ts). RENAME-NORMALISED DIFF GATE mandatory: sed the renames over
  the pre-image (`git show <base>:<path>`), diff against post-image, byte-empty
  or explain every residual line in the commit body.
- S9: delete the 18 section forwarders + their stale delegation comments; every
  name proven consumer-free by grep first; tighten ratchet. DURABLE RESTING
  STATE — commit must be green standalone.
- S10–S13: same four-beat for ShowsController as `readonly library` (30
  forwarders, ~39 internal uses, ~323 test hits — the biggest batch; same diff
  gate at S12, delete + ratchet tighten at S13). DURABLE at S13.
- If the chunk stalls mid-way, stop at the last durable state (S9 or S13) and
  report — do not leave a half-migrated cluster.
- Report: per-step shas, gates numbers, ratchet trajectory, measured vs plan
  counts, deviations.
