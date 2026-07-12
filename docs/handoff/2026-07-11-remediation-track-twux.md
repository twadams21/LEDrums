# Track T — twux fleet (remediation experiment, half A)

**You are the top-level orchestrator — you report to no one but Trent.** The session
that launched you is retiring from this initiative and is NOT your parent in practice:
do not send it status messages, reports, or completion notices (`twux send-message
--session parent` is not part of your workflow). Your only upward channels are the
scorecard + report deliverables named at the end of this doc, and AskUserQuestion /
inbox messages to Trent for genuine escalations. Track W (the sibling experiment) is
launched separately by Trent AFTER you finish — it is not your concern and you must
not start it.

You are the **orchestrator** of Track T. You implement 6 of the 11 slices from the spec
"Spec: Patch-Graph Integrity & Review Remediation (Waves 1–2)"
(<https://app.notion.com/p/39ab3e4fbab1819f8042d94608326ff7>) using a **twux fleet**
(real tmux implementer sessions per the twux skill / lanes playbook). A sibling track
runs the other 5 slices via dynamic Workflow runs — this is a deliberate A/B test of the
two orchestration approaches. Do not coordinate with the other track; just never touch
its files (fence below).

Notion CLI access: `ntn` works from agent shells (`NOTION_KEYRING=0` is already in
`~/.zshenv`). Each slice brief is a Notion page and is the implementer's contract —
anchors to verify, scope fence, evidence, report format, escalation triggers.

## Slices (dispatch in this order)

| Wave | Slice | Effort | Brief |
|---|---|---|---|
| 1 | S01 — setKitOutputs schema gate | medium | <https://app.notion.com/p/39ab3e4fbab1815aba1fc6243c177a4b> |
| 1 | S02 — PatchGraphView fault self-heal | medium | <https://app.notion.com/p/39ab3e4fbab181d89d69e85e371c52ef> |
| 1 | S05 — Extract native-MIDI + update-status HTTP handlers | medium | <https://app.notion.com/p/39ab3e4fbab181e5a9a6e29c6d04c1ba> |
| 2 | S07 — Core routing-validation module (new seam) | **high** | <https://app.notion.com/p/39ab3e4fbab181abbd9cfd1b9af97164> |
| 2 | S08 — Cleanup wave: UI copy ×10 + dead exports + knip | low | <https://app.notion.com/p/39ab3e4fbab181ee92bcf187172812d1> |
| 3 | S11 — Editor-side fan-out rejection | medium | <https://app.notion.com/p/39ab3e4fbab181db9fc5e83e68da14af> |

Dependencies: S07 needs S01 merged. S08 needs S02 merged (shared PatchGraphView.svelte).
S11 needs S07 + S08 merged. Wave 2's two slices are file-disjoint — run them in parallel.

## Rules

- **Integration branch:** create `track/twux` off `main` at start; every slice branch
  merges into it. NEVER touch `main`. Record the starting SHA.
- **Parallelism cap:** 3 implementer agents wide, max. Implementers: Opus at medium
  effort by default; S07 at high. Never xhigh. One task = one agent — never two agents
  on the same slice.
- **Verify from git, not pane captures.** A slice is merge-ready only when its branch
  shows the commit, the fence was respected (diff the file list), and the full sweep
  (`pnpm typecheck` + `pnpm test`) is green ON THE MERGED RESULT in your tree.
- **Review phase:** after each merge, run a review of the slice diff against its brief
  (acceptance + fence + spec intent). Findings → send back to the implementer (or fix
  trivial ones yourself with a note). After S11 lands, run one track-level review of
  `git diff main...track/twux`.
- **Escalations:** the briefs mark genuine stop-and-ask ambiguities (S07's loadProject
  boot question especially). When an implementer escalates, decide if you can resolve
  it from the spec; if not, surface it to Trent and pause only that slice.
- **Line-number drift:** briefs pin file:line anchors from 2026-07-11 main; implementers
  must re-locate by symbol, per their contracts.

## Cross-track fence — files you must NOT touch

`apps/web/src/lib/trigger-lab/store.svelte.ts` · anything new under
`trigger-lab/store/` (mod-graph/param-envelope) · `packages/core/src/voice/scope.ts` ·
`voice/compositor.ts` · `trigger-lab/render.ts` · `docks/inspectors/scope-inspector.ts` ·
`ControllerStatusPanel.svelte` · `lib/styleguide/**` · `docs/design-system.html` ·
`packages/protocol/**` · `apps/server/src/ws-protocol.ts` · `apps/web/src/lib/ws/**`.

Known one-line conflict candidate at final integration: the `packages/core` root barrel
(both tracks may add an export line). S07 should export via the model/geometry barrel +
one root line; accept that this line may conflict trivially at the end — Trent merges
the two track branches.

## Scorecard (the point of the experiment)

Track per slice: wall-clock (dispatch → accepted merge), escalations (count + what),
review findings (count/severity, rework loops), gate failures, fence violations, and
implementer usage if visible from session footers. Track overall: total wall-clock,
your own orchestration overhead (approx), human interventions.

When the track is done: write the scorecard as a Notion child page of the spec titled
**"Scorecard — twux track"**, and a short completion report in
`docs/handoff/2026-07-11-track-twux-report.md`. Leave `track/twux` unmerged — Trent
integrates both tracks.
