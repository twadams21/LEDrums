# Trigger Lab — throwaway model probe

**Question:** Before we touch `packages/core` or build the real Arrange view, decide
three branches of the trigger / look model by *playing* it, not mocking it.

Run: `pnpm --filter @ledrums/web dev` → http://localhost:5173/?proto=trigger
(no engine needed — the lab simulates an abstract voice model; voices are coloured
envelopes, not real pixels).

## The three branches under test

1. **Voice model.** Each bus (= layer) has a polyphony rule:
   - `mono` → a new voice **steals** the bus; the old one releases over `xfade` ms → a **morph**.
   - `poly` → voices **stack** and decay.
   Loops live on mono buses (the persistent look); one-shots on poly buses (transient).
   *Decide:* is "layers-as-buses with mono/poly + crossfade" enough, or do we need a
   separate voice concept above layers?

2. **Block set (trigger behavior tree).** A `(drum, zone)` hit runs a tree, authored on an
   infinite pan/zoom **node canvas** of nested cards (scroll = zoom, drag = pan, `+` adds):
   - leaf **Play** (mode = one-shot / loop / hold · **scope = drum / kit**, which filters the
     effect picker — kit effects spill over the whole kit as a 3D wash)
   - containers **All** (fire every child), **Random** (pick one, no-repeat),
     **Sequence** (round-robin across hits), **Switch** (pick by velocity/section/beat)
   - modifiers **Chance** (probability), **Toggle** (latch start/stop)
   Fire the pad; watch the 3D kit preview demonstrate each effect + read the resolution log.
   *Decide:* is this the right vocabulary? What's missing / unused?

3. **Section blend.** Transition mode = `cut` (instant) / `morph` (timed crossfade via
   voice-stealing) / `blend` (live two-deck crossfader holding A + B at once).
   *Decide:* timed morph enough, or do we want the live two-deck crossfade?

## How to drive it

- Kit: Kick, Snare, Tom, Tom 2. Click a pad (or press `1`–`9`) to fire; the pad you hit
  becomes the one you edit on the canvas.
- Snare·center = Random, Tom·center = Sequence, Tom·edge = Switch(velocity — move the
  `vel` slider), Snare·rim = All, Kick·shell = Toggle(loop), Snare·shell = Chance 50%,
  Tom·rim = Random{ loop, All }, Tom 2 = Sequence / Chance. Kick·center = plain one-shot.
- On a Play card, toggle **drum / kit** scope to see a hit stay on one drum vs wash the kit.
- Each Play card shows an **animated effect thumbnail** → click it to open **clip settings**
  (preset dropdown · parameters · per-param **envelope** popup · Instance/Linked toggle). The
  small **⇄** button opens the **effect gallery** (drum/whole-kit tabs) to change the effect.
- Presets: e.g. Swirl → Default / Wide / Fast / Sync (different hue/bands/speed/tempo-sync).
  A clip is its own **instance** by default; flip to **Linked** so edits sync to the shared
  preset. Envelopes (Decay/Rise/Pluck/Pulse) sweep a param over the hit's life — try Decay on
  Swirl's **angle** for a sweep as it decays.
- Flip a bus mono⇄poly and hammer it to feel steal-vs-stack. Drag `xfade` to feel morph length.
- Recall sections under each transition mode; switch to `blend` and drag the crossfader.

## Verdict (fill in once decided, then delete this directory)

- Branch 1 — voice model: _TBD_
- Branch 2 — block set: _TBD_
- Branch 3 — section blend: _TBD_
- Folded into: _core model PR / Arrange shape brief_
