# G2 — Settings modal refactor: colour + icons, new sidebar sections, split long panes

**Source:** Trent, in-session 2026-08-13 (this machine): the settings modal should gain "more
colour and icons and be easier to use"; the left sidebar gains a **Drum trigger zones** section
and a **Global controls** section; any section that is too long may be split into one or more
sections. **Base:** branch off `origin/feat/tabbed-chrome` (PR #176's head — this stacks on the
tabbed chrome). PR targets `feat/tabbed-chrome`, NOT main. Open with:

```
git fetch origin && git checkout -b feat/settings-sections origin/feat/tabbed-chrome
git log --oneline -3   # confirm tip is ce164fd or a descendant; if the branch is GONE
                       # (merged + deleted), STOP and report before basing on main
```

**Read first, in your worktree:** `docs/plans/2026-08-13-tabbed-chrome-slices/S4a-pane-spec-OUTPUT.md`
— the settings parity contract. Every mutator it homes must stay reachable after your refactor.
That document is the constitution of this surface; this brief only adds to it.

## Goal

The modal (`apps/web/src/lib/app/settings/SettingsModal.svelte`, 148 lines) has 5 sidebar
sections: Input · Drums & Hoops · Outputs & Chains · Controller · System (SECTIONS registry,
lines 29–35; lucide icons at size 14, no colour). Three changes:

### 1. New sidebar sections: Drum trigger zones · Global controls
`InputPane.svelte` (195 lines) currently stacks four things: MIDI input, OSC input,
`GlobalControlsPanel`, and per-drum zone lists. Split it:
- **Input** keeps MIDI input (channel + device list) and OSC input.
- **Drum trigger zones** — new pane hosting the per-drum `DrumZonesList` fieldsets (the hint
  text, kit-order iteration, `drum:<id>` rename honouring, viewer fieldset gating, and the
  authoritative-`project.kit.drums`-with-fixture-fallback behaviour all move with it, intact).
- **Global controls** — new pane hosting `GlobalControlsPanel`.
`DrumZonesList.svelte` and `GlobalControlsPanel.svelte` are **reused from their current
paths** — imported, never moved or forked (`TriggerSourceInspector` imports DrumZonesList
too; the styleguide references components in place).

### 2. Colour + icons — easier to scan
Every sidebar entry gets an icon (lucide, the existing `import X from
'@lucide/svelte/icons/x'` pattern) and a colour treatment. The palette is NOT yours to
invent: use the existing role/state tokens (`tokens.css` — `--role-input`, `--role-output`,
`--role-mod`, `--role-modulation`, `--live`, `--ok`, etc.) and pick hues whose signal-flow
semantics actually match the section (e.g. Input ↔ `--role-input`, Outputs ↔ `--role-output`).
How the colour lands (icon tint, active-state accent, left edge bar, grouped headers with
`Eyebrow`…) is your design call — apply `/make-interfaces-feel-better`, keep it quiet and
Linear-like (PRODUCT.md register), and keep AA contrast (the repo gates on the sRGB
rendition — `apps/web/scripts/contrast-check.mjs`; don't introduce raw hex, use tokens).
Carry the same icon/colour identity into each pane's header so sidebar ↔ pane feel linked.

### 3. Split anything too long
With Input split, review the remaining panes as a user would: `ControllerPane.svelte`
(265 lines: status panel · transport form · kit globals) is the strongest candidate — e.g.
Controller (status + transport) vs a separate home for kit globals — and `OutputsChainsPane`
(200 lines: output cards · unassigned pool · pixel map) may deserve internal structure or a
split. Whether and where to split is your judgment; a 6–9 item sidebar with clear groups is
fine, a museum of one-field panes is not. Two hard rules when splitting:
- The parity contract holds: nothing homed by S4a becomes unreachable.
- The `watchController(true/false)` + `requestNetworkAdapters()` mount/unmount lifecycle
  (`ControllerPane.svelte` ~line 68) stays attached to whichever pane hosts the controller
  status/transport, and the modal keeps rendering **only the active pane** — S4a §2.4 calls
  a shell that keeps inactive panes mounted a defect.

## Routing (lockstep with tests)

- New pane keys extend `SettingsPane` in `apps/web/src/lib/app/shell-nav.ts` (+ its test —
  it's the pure reducer; keep it pure).
- Deep-links: existing `?settings=<pane>` keys keep working — `input`, `system` (UpdateBadge
  opens it: `TopBar.svelte:86`), and the `?view=patch` → `outputs` redirect
  (`shell-nav.ts:108`) are load-bearing; renaming existing keys is out of scope. New sections
  get their own keys.
- Close-path seam stays: closing the modal disarms `cancelMidiLearn()` + `cancelOscLearn()`
  (`SettingsModal.svelte:51-55`, asserted by `SettingsModal.test.ts`). Moving
  GlobalControlsPanel/zones to other panes must not weaken this — learns armed from any pane
  must disarm on close AND on switching away from the arming pane if that's how it behaves
  today (verify, don't assume).

## Anchors to verify before building

- `apps/web/src/lib/app/settings/SettingsModal.svelte` — SECTIONS registry, lastPane memory,
  close path, 200px sidebar grid.
- `apps/web/src/lib/app/settings/panes/*` — current pane contents and line counts
  (InputPane 195 · DrumsHoops 114 · OutputsChains 200 · Controller 265 · System 70).
- `apps/web/src/lib/app/shell-nav.ts` + test — `SettingsPane`, `parseSearch`,
  DEFAULT_SETTINGS_PANE.
- `InputPane.test.ts` (105 lines) — assertions that must survive, relocated to the new panes'
  tests (kit-order zone lists, rename honouring, setInputMap path, viewer gating, device
  empty state).
- `docs/plans/2026-08-13-tabbed-chrome-slices/S4a-pane-spec-OUTPUT.md` — the parity contract.
- ui-shot presets (`scripts/ui-shot/`) — do any enumerate `?settings=` panes?

## Scope fence

May mutate: `apps/web/src/lib/app/settings/**` (modal, panes, new pane files + their tests),
`apps/web/src/lib/app/shell-nav.ts` + `shell-nav.test.ts` (SettingsPane union only),
ui-shot presets, `apps/web/src/lib/styleguide/` entries + regenerated
`docs/design-system.html`, `TopBar.svelte` ONLY if a settings deep-link key must be updated.

Non-goals (do NOT touch): `apps/web/src/lib/trigger-lab/store.svelte.ts` or any store/
controller module (**hard fence — a sibling slice owns store mutations**; you call existing
mutators only), `chrome/GlobalControlsPanel.svelte`, `chrome/OscInputPanel.svelte`,
`docks/inspectors/**` (all reused in place — if a reused component needs a change to fit,
escalate instead), `views/**`, engine/protocol/server code, tokens.css (consume tokens, don't
redefine them). Crossing the fence obliges pasting the diff in your report.

## Code discipline (binding — deviations are review findings)

- Match the surrounding idiom: Svelte 5 runes discipline (`/efficient-svelte`), near-zero
  comments, existing naming. Panes compose `Field`, `CommitInput`, `Eyebrow`, `Separator`,
  `Select`, `Toggle`, `ReadRow`, `IconButton`, `ListItem` — no hand-rolled controls.
- Pure logic in `.ts` modules with unit tests (the `chain-editor.ts` / `drums-hoops.ts`
  pattern). Components stay thin.
- No new dependencies. No `as any`. No defensive try/catch. No back-compat shims, feature
  flags, or dead registry slots. No drive-by refactors of files you merely pass through.
- Tests move WITH behaviour: assertions from `InputPane.test.ts` land in the new panes'
  tests, not deleted. Test names describe behaviour, not implementation.
- Icons always paired with a visible label in the sidebar; icon-only affordances get
  tooltips (house rule: icon+tooltip always).

## Non-negotiables (AGENTS.md binds you)

- Compose from `docs/design-system.html`; if the coloured sidebar item becomes a reusable
  primitive, it gets a styleguide entry + `pnpm design-system` regen in the same change.
- Apply `/make-interfaces-feel-better` before calling UI done.
- Verify with `pnpm ui-shot` captures: the sidebar (new sections + colour), each new pane,
  and one existing pane for regression. `UI_SHOT_BASE` = your worktree pool port
  (`twux worktree port`), never :5173.
- `pnpm test` + `pnpm typecheck` green on **committed HEAD** before push. Push via
  `twux push`; verify the remote has your sha (`git ls-remote`) — do not trust the report.

## Evidence + report

Effort: **high** (pinned at launch). One PR into `feat/tabbed-chrome` when done (open with
`gh pr create --base feat/tabbed-chrome`). Commit body = the report (<30 lines): final
sidebar section list (names, keys, icons, hues), what split where, parity statement ("every
S4a-homed mutator reachable — verified by walking the panes"), files touched, test-count
delta, ui-shot names, deviations. Completion message to your parent via SendMessage: one
line — sha, branch, PR number, gates status.

## Escalation triggers (stop and SendMessage the orchestrator)

- Any split would orphan an S4a-homed mutator or read-out, or forces changes to a
  reused-in-place component (DrumZonesList, GlobalControlsPanel, OscInputPanel,
  OutputStatusPanel).
- The learn-disarm seam can't survive the pane split without store changes (store is the
  sibling slice's fence).
- Sidebar taxonomy feels genuinely ambiguous after exploration (e.g. where kit globals
  belong) — propose, don't guess silently: one SendMessage with your recommendation, keep
  building the un-ambiguous parts meanwhile.
- Any conflict with an AGENTS.md non-negotiable or the S4a parity contract.
