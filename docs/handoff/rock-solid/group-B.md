# Group B — IO confidence surfaces (issue #47, lane 1)

Lane-1 orch group report. Branch: `group/B` (off `rock-solid` @ 9b7022f, head 954d93f).
Four slices, all merged `--no-ff`, full sweep after every merge.

## Slices

- **S02 — OutputPill truth from OutputStatus** (`slice/S02` @ 6a0b0c7, impl
  `S02-outputpill-671081`): pure `deriveOutputPill` truth table (link × OutputStatus →
  LIVE/ERR/DRY/ARMED/OFF/SYNC/LOCAL); LIVE impossible while `lastError` set or packets not
  flowing (invariant enforced by branch order + 3 invariant tests; 14 new tests).
- **S03 — Output status panel** (`slice/S03` @ fe01ce9, impl `S03-output-panel-8958f3`):
  `OutputStatusPanel` in the Patch controller inspector — state pill, packets/s, universes,
  target host:port/protocol, prominent last error. Pure `packetsPerSecond` returns `null`
  when a rate can't be honestly derived (first tick, non-advancing clock, counter reset) and
  `0` when armed-but-stalled (truth the panel must show).
- **S04 — Input activity badges** (`slice/S04` @ 8ba8501, impl `S04-input-badges-d7d99f`):
  "last heard" badges in trigger-source + patch-zone inspectors; pure `input-activity.ts`
  matcher keyed by stable identity (note/address) so non-matching traffic can never churn a
  badge; new `InputActivityBadge` `lib/ui` primitive + styleguide entry.
- **S05 — MIDI device list in settings** (`slice/S05` @ 755b1bb, impl
  `S05-midi-devices-5e7139`): WebMIDI input enumeration (`enumerateDevices`, pure over the
  access handle) + hot-plug refresh via `statechange` (disconnected ports grey out rather than
  vanish); settings dialog device list with permission-explaining empty state.

## Merges

- S03 forked pre-S02; both adopted `OutputStatus` into the store. Resolution: impl rebased
  `slice/S03` onto current group/B on my instruction (kept S02's adoption, layered its
  packets/s sampling) → zero-conflict merge. `docs/design-system.html` conflicts are always
  resolved by regeneration, never hand-merged (repeat pattern for later groups).
- S04 rebased itself onto post-S03 group/B (design-system regen; store auto-merged).
- S05 verified clean 3-way via merge-tree before reporting; merged clean.
- Full sweep after every merge; final: typecheck 0 (6 pkgs), **1079 tests / 0 skips**
  (io 13 · core 234 · protocol 1 · server 170 · web 661). Group diff 27 files +1707/−68.

## Group review (full diff vs doc 01 § confidence UI + slice file + AGENTS.md)

Verdict: **PASS, no findings requiring fixes.**

- All four pure modules read line-by-line (`output-pill.ts`, `output-status.ts`,
  `input-activity.ts`, `webmidi.ts` additions): each is pure, total, and honest about
  unknowns (null over guesses); UI components are thin renderers over them.
- Acceptance criteria all evidenced in committed tests (see per-slice reports S02–S05).
- AGENTS.md non-negotiables: web-only (core purity untouched — verified via group diff);
  design system engaged per slice (S02/S03 styleguide demos; S04 adds a reusable primitive +
  demo; S05 composed existing `StatusPill`, nothing new-reusable — compliant);
  `/make-interfaces-feel-better` applied on UI slices.
- Deviations accepted: `.gitignore` +`dist-design-system/` (S02); error tone reuses the red
  `live` hue with pulse+ERR+tooltip since the palette deliberately has no separate danger hue
  (S02, consistent with tokens.css taxonomy).

## Context pack for dependent groups/lanes

- **L (S48) extends the S03 panel**: embed PixLite controller stats into
  `apps/web/src/lib/app/docks/inspectors/OutputStatusPanel.svelte`; derivations live in
  sibling `output-status.ts` — extend, don't fork. S03's report has the seam detail.
- The store now tracks `output` (S02), packet samples (S03), `inputActivity` map + age clock
  (S04), and `midiDevices` (S05) — all fed from the existing `stats`/`state`/`input` WS
  messages; no protocol changes were needed anywhere in group B.
- Badge/identity seam: `activityKey` (note/address) is the lookup contract; reuse it for any
  future "last heard" surface (e.g. PixLite discovery liveness).
