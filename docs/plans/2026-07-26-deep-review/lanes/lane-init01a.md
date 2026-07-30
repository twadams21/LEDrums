# Lane: INIT-01 chunk 01A — server spine (S1, S2, S5, S7)

Read `lanes/COMMON.md` and the **Chunk 01A** section of `lanes/init01-chunks.md` —
both bind. Branch: `init/01a-server-spine` off `review/impl` (HEAD `98b38f6` or
later; INIT-04 is merged — re-measure baseline, expect ~3188 tests).
Plan steps: `09-synthesis/INIT-01-single-render-stack.json` S1, S2, S5, S7 only.

Key cautions:
- main.ts moved under INIT-04 (ws-broadcast.ts / ws-connection.ts / stats-frame.ts
  extracted; fatal-shutdown, boot-project ladder landed). Verify every plan anchor
  against the real file first; a step's target may now live in an extracted module.
- Scope fence: the four steps' file lists (adjusted for the extractions) only.
  Do NOT touch the superseded steps' territory (sim.ts etc. — chunk 01B owns it).
- Resting state on completion: voice is the default engine, parity harness green,
  legacy reachable only via explicit LEDRUMS_ENGINE=legacy.
- Report: final sha + per-step shas + gates numbers to parent.
