# Lane: INIT-06 chunk 06C — drop the 'play' NodeKind alias (decision-mandated)

Read `lanes/COMMON.md` and the **Chunk 06C** section of `lanes/init06-chunks.md` —
both bind. Branch: `init/06c-alias-drop` off `review/impl` (start at origin
HEAD; re-measure baseline at your starting HEAD and report it).
This chunk exists because 11-decisions.md's INIT-06 row mandates the legacy
'play' alias drops from the AUTHORING union; the plan's open question 4 priced
it out of S1–S14, so it runs with its own fence (06A's ask fef534 / answer
2dafb2 is the provenance).

THE CONTRACT: authoring-side drop only. The LOAD path keeps rewriting
'play' → canonical on ingest (normalizeTriggerGraphToGen3) — greenfield
posture (two users, no real show files) means no persisted-data migration
machinery, but a pasted/loaded old doc must still normalize, never crash.

FENCE (from the chunk doc): packages/core/src/voice/types.ts (the union),
web hydrate's pre-normalisation migrations, persistence.ts's cast, clipdoc's
load path — plus the mechanical fallout the compiler names (dispatch Records
that carry the 'play' key, e.g. trigger-flow-projection's KIND_SIG which 06A
marked deliberately temporary with 06C as owner). Anything beyond
compiler-forced fallout: STOP and ask.

- Work compiler-out: shrink `NodeKind` to CanonicalGraphNodeKind (or delete
  LegacyGraphNodeKind entirely if nothing else references it), then fix every
  site the compiler names, each fix the MINIMAL one.
- The KIND_SIG 'play' entry and its 06C comment go; the golden-table test's
  'play' row updates to whatever the load-normalizer story requires (the
  normalizer maps 'play' → 'effect' BEFORE any signature is computed — verify
  that ordering and pin it if unpinned).
- Load-path proof: a doc containing kind:'play' still loads and renders as
  effect — find the existing normalizer tests and extend, or add one
  red-first against a hand-built old-shape doc.
- Gates green per committed step (foreground `pnpm gates`).
- Report: shas, gates numbers, the compiler-named site list, deviations.
