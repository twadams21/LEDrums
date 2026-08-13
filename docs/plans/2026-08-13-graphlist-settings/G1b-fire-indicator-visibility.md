# G1b — Fire indicator: make it unmissable

**Follow-up on your G1 slice (PR #179), from Trent playing the preview 2026-08-13:** triggering
graphs with the laptop keyboard, he could not see the fire indicator at all — "I can't see
where the graph fire indicator is / is meant to be." The 520ms `.fireburst` border flash on the
rail card is too subtle and too brief to serve #177's purpose (tracing which graph a hit
renders). The signal architecture you built (`lastGraphFire` / `markGraphFire` /
`graphFireAt`) is right — this is a presentation fix.

**Base:** your existing branch `feat/graph-list-177` (worktree
`/Users/trent/.twux/worktrees/graphlist`, clean at `3215bb7`). New commit(s) on the same
branch, push updates PR #179.

## Goal

1. **The instant of fire is unmissable** — visible in peripheral vision while the user watches
   the canvas or a drum kit, not just when staring at the card. Design is yours
   (`/make-interfaces-feel-better`): consider a full-card accent wash that decays, a hotkey-
   badge pulse, thumbnail dots lighting — whatever reads at a glance. The house "no node
   lift/click motion" rule governs *pointer interactions*, not fire feedback; motion is
   allowed here, but keep it engineered, not carnival.
2. **A lingering recency cue** — after the burst, the card should show it fired recently
   (e.g. a small indicator cooling over a few seconds via `graphFireAt`), so a hit you missed
   live is still traceable a beat later. This is the diagnostic half of #177.
3. Rapid re-fires (drum rolls) must read as activity, not a stuck state — the `{#key seq}`
   restart idiom or an equivalent.

## Verify LIVE (this is the acceptance)

Drive it in a real browser against your worktree dev server (your pool port; note 4323/5373/
9102 are taken by the orchestrator's preview stack — pick free ports): fire via keyboard keys
1–9 in the Trigger view and confirm the indicator is obvious at arm's length; screenshot
mid-burst (ui-shot `--click` you built, or a timed capture) and include the shot names in the
report. Check both offline and connected (voice engine) modes.

## Fence + discipline

Same as G1: `TriggerGraphsRail.svelte` (+ its styles), `graph-thumb.ts` only if dots
participate, store only if a timing/decay needs it (prefer not). No new dependencies; tokens
only, AA on sRGB. Tests updated in lockstep if behaviour changes. `pnpm test` + `pnpm
typecheck` green on committed HEAD, push via `twux push`, verify sha on remote.

## Report

Commit body <30 lines; SendMessage one-liner to the orchestrator: sha, what the indicator now
does (burst + lingering cue), shot names, gates. I re-merge the branch into the live preview
after your push.
