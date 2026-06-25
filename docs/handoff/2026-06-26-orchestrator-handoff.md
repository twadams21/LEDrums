# LEDrums — orchestrator session handoff (2026-06-26)

Detailed handoff for the next orchestrator agent. Read this, then `.mex/ROUTER.md` and
`docs/plans/2026-06-21-ui-redesign.md`.

## Who/where you are
- You are the **orchestrator** (session `unified-shell-a69e0f`). **Trent drives you directly in this
  pane** — there is NO parent to report to (do not `twux send-message --session parent`).
- Branch **`feat/unified-shell`** — as of this handoff it is **committed AND pushed to GitHub** (origin).
  NOT merged to `main`, no PR yet. Keep committing milestones here; Trent says when to merge/PR.
- Dev stack is running in the background: **web `:5173`**, **voice server `:4321`**
  (`LEDRUMS_ENGINE=voice`). Hot-reloads on edit. Tailscale serve exposes `…tail568a80.ts.net:5173`.

## Gate status (authoritative, on the committed tree)
- `pnpm typecheck`: **0 errors** (packages/core, packages/io, apps/server, apps/web all green).
- `pnpm test`: **303 passing** — core 156, server 36, web 99, io 12.

## What this session shipped (all on `feat/unified-shell`)
Newest → oldest. Earlier shell/kit/section work from prior sessions is summarised in ROUTER.

1. `ad390ab` docs(mex): ROUTER batch record.
2. `b1765a2` **Patch Graph topology** — real 8-stage `@xyflow` device routing
   (input→trigger→zone→drum→hoop→dataline→output→controller), pure `lib/app/patch-topology.ts`
   (12 tests, 46 nodes/70 edges), `PatchNode`/`PatchFitView`, data-driven from store + `DEFAULT_KIT`.
   *Orchestrator committed this on the agent's behalf — it reported done with green gates but had not
   run `git commit`.*
3. `0b03ed7` **Live Show re-sync** (orchestrator wrote this directly) — the store now re-sends `setShow`
   on authored edits (debounced off the autosave tick, signature-guarded so tempo/node-drag don't
   reset voices). Fixes "changing an effect in a graph keeps firing the original effect" (server Show
   was frozen at connect time).
4. `f7fb63f` + `f9f67f6` **Arc-segment LEDs** — continuous curved thick rings replacing gapped
   box-tubes; cold geometry / hot per-vertex colors; camera-framing fix preserved. `Pixels.svelte` only.
5. `3b2da91` **Per-zone trigger firing** — section slots re-keyed by **padKey** (`drumId:zone`); was
   per-drum, so every zone fired the seeded zone-0 graph (Tom1 Edge/Rim → Centre's graph). Restores
   per-zone behaviour with fallback to the pad's own graph. Plus **effects-union** on hydrate so the 41
   built-ins always surface for returning (localStorage) users.
6. `1ec20f1` **All 41 original effects** — voices host legacy `EffectGenerator`s via the core registry
   (server output + offline preview). Permanent whole-frame bridge strategy (Trent approved mid-flight).
7. `fcb2485`/`82bdb8a`/`099b9db` **Resizable docks · create-new-graph · live persistence** — `lib/ui/
   Splitter` (drag+keyboard, sizes persisted), `store.createGraph`, localStorage autosave of authored
   state (no save button, hydrate-before-connect).
8. `c311e81` **Duplicate-slot-key guard** — per-slot state prefix so two layers of one graph run
   independently.
9. (earlier this session) `5463bee` **#2 seed-from-core** — server seeds default project from
   `defaultProject()`→`DEFAULT_KIT`; deleted hand-edited `apps/server/projects/default.json`;
   `loadProject` runs `assertProjectIntegrity`. And `ab58311`+`c73bd5f` **section-aware engine playback**
   (the prerequisite the per-zone fix built on).

## Agent fleet (all PARKED, kept alive for audit — never close panes)
`guard-dup-8d8e7d` · `web-persist-8c3507` · `effects-port-8488aa` · `zone-fix-bdb9fc` ·
`fix-3drot-be6464` (did camera fix + arc LEDs) · `patch-graph-e127c4` · `kit-source-455b19` (prior).
`arc-seg-6ed2af` was a DUPLICATE of the arc task (orchestrator error) — Trent exited it; it never wrote.

## Live spot-checks for Trent on :5173 (can't be unit-verified)
- Swap an effect in a graph → changes apply live (the `0b03ed7` fix).
- Tom1 Edge vs Centre fire different graphs (per-zone).
- 3D rings continuous + thick; camera doesn't reset on pad hits.
- Patch Graph renders 8 stages; click a node → Inspector summary.
- Edit something / drag a dock → reload → restored.
- Use ONE client while authoring (multi-client = competing setShow/key on one engine).

## Open follow-ups / roadmap (none blocking; pick with Trent)
- **Patch**: wire data-line/output to the real server `dmxMap` (currently a sensible fixed-capacity
  default that demonstrates cross-wiring); editable device settings in the Inspector.
- **Effects**: live-stream effects (swing/sidechain/pixel-accum) only see their own hit (render
  single-shot) — needs per-frame trigger history fed to hosted generators; color/enum params not
  voice-editable; gallery should group by `category` (all generators are kit-scoped).
- **Show sync**: a finer-grained live-update message that does NOT reset engine voices (current
  `setShow` clears the voice pool + reseeds PRNG); proper multi-client handling.
- **Output**: real Art-Net arm/dry-run/off (OutputPill is link-derived); MIDI/OSC zone convention
  (numeric `pad.zone` vs `SLOT_LABELS`) for real hardware input.
- **Consolidation**: merge `feat/unified-shell` → `main` + prune now-unused legacy `lib/shell`,
  `lib/views`, `lib/store` (when Trent says).

## Gotchas / lessons (IMPORTANT — these bit us this session)
- **One task = one agent.** Never point two agents at the same task/files. I unparked `fix-3drot` for
  the arc task AND launched a fresh `arc-seg` for it — a duplication Trent caught (no damage, by luck of
  timing). Partition strictly by disjoint files.
- **Verify agent state from git, not pane captures.** A `"Press up to edit queued messages"` placeholder
  + an unchanged context % led me to wrongly claim an agent "did nothing" when it had actually finished.
  Always `git status`/`git log`/`git diff` the agent's files before reporting it done/idle/stuck.
- **Agents may report "done" with green gates but not commit.** Always git-verify; if the pane is idle
  and the tree is green, commit on their behalf.
- **Unparking a parked pane can wedge its input** (stuck-Enter: prompts queue but never submit — three
  tries failed). Don't fight it — **re-launch a fresh agent** (reliable). The fresh launch is what
  finally ran. (Worktrees would NOT fix this — it's input delivery, not files.)
- **`twux launch --color` accepts only named colors** (blue/purple/orange/green/yellow/cyan/pink/red),
  NOT `colourNN` — an invalid color aborts the launch before the pane is created.
- **Shared working tree**: partition by disjoint files. The cross-package `pnpm typecheck` goes RED
  while ANY sibling has uncommitted WIP (web/core typecheck depend on core types). During work use
  `pnpm --filter @ledrums/web typecheck`; run the full `pnpm typecheck && pnpm test` sweep ONLY on the
  fully-committed tree (the one moment it's clean).
- **`setShow` resets engine voices** (clears pool + reseeds PRNG) — that's why the live re-sync is
  signature-guarded (skip no-ops + x/y drags).

## Orchestration mechanics
- `twux`: `launch` / `park` / `unpark` / `list` / `capture --session <id> --lines N` / `prompt --session
  <id> --body` / `bash --session <id> --cmd` / `wait --session <id>` / `usage`. Park finished agents
  (declutter, keep for audit); never close panes.
- Launch implementer agents as **`--model opus --effort xhigh`** (Trent's preference) with a plan
  preload (`--bash "cat docs/prompts/<brief>.md"`) + a spelled-out report-back to `--session parent`.
- **Usage gating**: `twux usage` before launching; don't launch when 5h is >~90% (it resets on the
  cadence shown; background a `twux wake --at <iso>` and resume after).
- Monitoring: rely on agents' `[twux:msg]` reports (they surface to you automatically) rather than
  polling idle-watches, which fire on transient between-turn idles and burn turns.
- Briefs for this batch live in `docs/prompts/*.md` (guard-dup-slot, fix-3d-rotation-reset,
  web-persist-newgraph-resize, port-all-effects, fix-zone-firing, patch-graph-topology, arc-segments,
  section-playback).
- Memory saved: `parallel-agent-orchestration.md` (one task=one agent; verify via git; never assert
  unverified state).
