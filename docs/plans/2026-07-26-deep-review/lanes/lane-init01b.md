# Lane: INIT-01 chunk 01B — core noise dedup + sim retirement (S4 + Decision 3)

Read `lanes/COMMON.md` and the **Chunk 01B** section of `lanes/init01-chunks.md` —
both bind. Branch: `init/01b-sim-retirement` off `review/impl` (HEAD `98b38f6` or
later; re-measure baseline, expect ~3188 tests).

Work:
1. S4 from `09-synthesis/INIT-01-single-render-stack.json` as written (noise fns
   → packages/core/src/math.ts).
2. Decision-3 replacement (11-decisions.md — overrides plan steps S3/S6/S9/S10,
   which you must NOT execute): delete the web sim module family
   (apps/web/src/lib/trigger-lab/sim*, its tests/fixtures) and every consumer
   seam that existed only to feed the local preview mirror; the visualiser shows
   an honest "disconnected" state when the WS link is down. UI-GATED: design
   system + /make-interfaces-feel-better + ui-shot on YOUR dev port
   (UI_SHOT_BASE=http://localhost:$TWUX_DEV_PORT).

Key cautions:
- ESCALATE, don't guess, if anything besides preview/visualising consumes sim
  output (e.g. authoring flows that read simulated frames).
- Keyboard-fired section graphs (app-keys.ts, fresh from INIT-04) fire ENGINE
  input when connected — confirm what they did offline and preserve authoring
  semantics; if offline behaviour must change, that's expected (preview is
  retired) but say so explicitly in your report.
- No server files. Parallel sibling owns apps/server.
- Report: final sha + per-step shas + gates numbers + ui-shot paths to parent.
