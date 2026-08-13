# G3 — Settings cards: density, colour, and direct manipulation

**Follow-up on your G2 slice (PR #180), from Trent playing the preview 2026-08-13:** "The
settings modal and layout and colours and icons look great, but the cards within the pages
are still quite plain, dark, and hard to understand." Reference he named: the right-hand
preset-editor panel of `/Users/trent/Documents/dev/mc8pro/docs/proto/app.html` — *as
inspiration, translated into our tokens*, never copied hex-for-hex.

**Base:** your existing branch `feat/settings-sections` (worktree
`/Users/trent/.twux/worktrees/settings`, clean at `963444a`). New commits on the same branch,
push updates PR #180. Effort stays high.

## The reference design language (extracted for you — the file is 842KB, don't read it)

The mc8pro panel gets its clarity from density + typed identity + tiny type scale, not from
brightness:

- **Section anatomy:** uppercase mono eyebrow label + a right-aligned count ("8 of 32");
  content as a tight rowlist with a thin column-header row, 1px `~9%-alpha` borders between
  rows — dividers are whisper-subtle, never harsh.
- **Row anatomy:** dense grid rows (~42–44px min-height, `7-8px 10px` padding), a small
  right-aligned mono index column, a title, a **small colour-coded type badge/chip** (8.5px
  mono bold, tinted border + text — colour identity lives in the chip, NOT a whole-row tint),
  then a two-line cell: type label over a mono parameter read-out ("CC 9, val 127" style —
  label + decoded value in one glance).
- **States:** hover = faint ink wash (`~5%`); selected = a stronger accent wash; live/hit =
  3px inset LEFT accent bar; disabled = opacity dim on children. Transitions fast, `.13s`.
- **Empty + add:** empty state = dashed 1px border box, quiet text, inline "+ Add" button;
  lists end in a footer row: "+ Add X" link-button left, mono count right.
- **Drag:** `cursor: grab`, dragging item at `.4` opacity, drop position shown as a 2px inset
  top (`dropbefore`) or bottom (`dropafter`) bar on the target row.
- **Type scale:** section labels 9px/700/mono/wide-tracking · titles 11–11.5px/600 · values
  9.5px mono · badges 8.5px mono. Small, tight, engineered.

Translate: our `--ink/-muted/-faint`, `--surface-*`, `--border*`, the section hues you built
(`--sec-tint`/`--sec-wash`/`--sec-edge` per `data-settings-section`), role tokens for
per-item identity (e.g. a zone chip in `--role-mod`). Keep AA on sRGB (contrast-check),
tokens only, no raw hex. Where our existing primitives (Field, CommitInput, ReadRow) already
carry a pattern, restyle/extend them rather than bypassing them.

## Scope — four things Trent asked for, plus the restyle

1. **Card restyle across the settings panes.** Apply the language above to: drum-zone cards
   (zones pane), global-control rows (controls pane), drum cards + hoop rows (Drums & Hoops),
   output chain cards + pool chips + pixel table (Outputs & Chains), controller status +
   transport (Controller), MIDI device list (Input). Rows should read like the mc8pro
   messages: index/identity chip + label + mono decoded value, dense and scannable. "Plain,
   dark, hard to understand" is the complaint — typed chips, washes, and read-outs are the
   cure; brightness is not.
2. **Scroll-wheel value adjustment** — hovering ANY numeric control and scrolling adjusts it
   by **1 integer per wheel tick** (Trent's exact ask), committing through the control's
   existing commit path; `preventDefault` only while the pointer is over the control so page
   scroll is untouched elsewhere; respect min/max clamps; disabled controls don't respond.
   Implement once in the shared primitive(s) (`lib/ui/CommitInput.svelte` type=number, and
   any slider primitive) so every number field in the app gains it.
3. **Drag-and-drop hoop assignment** — drag a chip from the Unassigned pool onto an output
   chain (and between chains, and reorder within a chain if it falls out naturally). Reduce
   through the existing pure `chain-editor.ts` reducers + the same validation gate — DnD is a
   new gesture over the same mutation path, not a new path. Keep the move-up/down buttons and
   picker as the keyboard/fallback path. Drop indicators per the reference (`dropbefore`/
   `dropafter` bars). Native HTML DnD is fine; no new dependency.
4. **Controller pane on one screen** — target: no scroll at the modal's default size. The
   density from (1) plus layout (e.g. two-column transport grid, tighter status panel) should
   get you there. If something genuinely cannot fit, escalate with a proposal rather than
   silently keeping the scroll.

## Fence (expanded from G2 — read carefully)

May mutate: `apps/web/src/lib/app/settings/**`, `apps/web/src/lib/ui/*` (the wheel behaviour
+ restyles of primitives you already consume), **and — new** — the shared card components the
settings panes reuse in place: `docks/inspectors/DrumZonesList.svelte`,
`chrome/GlobalControlsPanel.svelte`, `chrome/OscInputPanel.svelte`,
`docks/inspectors/ReadRow.svelte` / `RenameField.svelte` — BUT each is mounted elsewhere too
(DrumZonesList in the Trigger-graph source inspector; the status panels in
controller-monitor), so every shared component you restyle must be ui-shot verified in its
OTHER mount as well, and behaviour there must be unchanged. Styleguide entries + regen in the
same change. Still forbidden: `trigger-lab/store.svelte.ts` and all store/controller modules
(existing mutators only), `views/**`, tokens.css redefinitions, engine/protocol/server.

## Discipline

Unchanged from G2 (runes discipline, pure logic in tested `.ts` modules — DnD reorder logic
included, no new deps, tests move with behaviour, icon+tooltip). Wheel + DnD get unit tests
at the pure layer and component tests for the gesture wiring where the harness allows.

## Evidence + report

`pnpm test` + `pnpm typecheck` green on committed HEAD; push via `twux push`, verify sha.
ui-shots: every restyled pane, the pool mid-drag if capturable, DrumZonesList in its Trigger
inspector mount, controller pane proving one-screen fit at default modal size. Ports: the
orchestrator's preview stack holds 4323/5373/9102 — pick free ones. Report: commit body <30
lines; one-line SendMessage with sha + gates. I re-merge into the live preview on your push.

## Escalation triggers

- The restyle of a shared component can't serve both mounts without forking it.
- Wheel-adjust fights an existing scroll surface (e.g. a scrollable pane under the pointer)
  in a way `preventDefault`-on-hover can't cleanly resolve.
- Controller one-screen needs information removal (vs densification) — propose first.
- Anything needing a store mutator change.
