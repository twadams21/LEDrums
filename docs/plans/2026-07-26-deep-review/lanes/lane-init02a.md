# Lane: INIT-02 chunk 02A — ratchet + tracer + small controllers (S1–S5)

Read `lanes/COMMON.md` and the **Chunk 02A** section of `lanes/init02-chunks.md` —
both bind. Branch: `init/02a-ratchet` off `review/impl` (start at origin HEAD;
re-measure baseline at your starting HEAD, expect ~3172).
Steps from `09-synthesis/INIT-02-store-decomposition.json`: S1, S2, S3, S4, S5
(S1+S2 may interleave; S3→S4→S5 strictly in order — each proves the pattern for
the next).

ANCHOR WARNING: the plan's store.svelte.ts line numbers predate INIT-01
(sim mirror deleted, voice-only runtime) — treat every `:NNN` as a hint, verify
each symbol against the real file first. Forwarder counts may have moved.

- S1: `store.surface.test.ts` — inventory + size ratchet pinning the store's
  public surface (prototype accessors + own keys; Svelte 5 compiles $state/$derived
  to prototype accessors). Construct via `new TriggerLab(fakeClient)` with the
  MemStorage beforeEach/afterEach pair from store.shows.test.ts.
- S2: close ui-shot preset gaps on the surfaces this initiative retargets —
  check `scripts/ui-shot/shots.json` coverage against the 02A-touched .svelte
  files only (OutputPill, PatchZoneInspector, TriggerSourceInspector,
  CcNodeInspector, DrumZonesList, AppSettingsDialog + monitor surfaces);
  wider preset work belongs to 02B/02C.
- S3 (tracer): publish ControllerTest — drop `private` from the field, do NOT
  add a same-named getter (duplicate member = compile error). Delete its 3
  forwarders; retarget the ~4 production sites.
- S4: publish MidiController (`store.midi`), delete its 6 forwarders, retarget
  ~19 store-qualified sites across 7 files.
- S5: rename private `monitor` → public `readonly controllerMonitor` (NOT bare
  `monitor` — it would sit beside the unrelated monitorEvents/monitorTypeFilter
  app-log cluster). Delete its 12 forwarders; retarget all sites.
- Every deleted forwarder proven consumer-free by grep before the delete commit.
- Resting state: three collaborators public, ratchet green, gates green.
- Report: per-step shas + gates numbers + ratchet count to parent.
