# Group D — Layout & kit geometry

Context: [doc 08](../08-layout-splitter-kit-flips.md) · Parent PRD: #45 · Stories: 47–50

## S09 — Right-dock resize rail `ui-light`

**Blocked by:** none.

**What to build:** A fourth Splitter instance between the visualiser and the inspector/monitor
panel in the right dock, following the existing controlled-splitter + persisted pane-size
pattern (new pane key, sensible default/min/max).

**Acceptance criteria:**
- [ ] Drag resizes the two panes within clamps; size persists across reload
- [ ] No layout regression in the other three splitters

## S10 — Per-drum flip (+ pixelsPerHoop forwarding fix) `plumbing` `ui-light`

**Blocked by:** none.

**What to build:** A boolean flip on the drum schema, applied inside the pixel-model build as a
pure reflection along the drum's local axis (skins swap) with angular direction negated so chase
direction reads correctly. Plumbed end-to-end: drum inspector toggle → transform message → server
→ engine/voice-host kit reload. Geometry only — pixel index order and DMX bytes unchanged. Fix
the latent gap where pixels-per-hoop isn't forwarded on the legacy engine path.

**Acceptance criteria:**
- [ ] Flip twice = identity (golden positions); skins swap (hoop-0 z ↔ hoop-N z); wind direction
      reversed
- [ ] DMX map byte-identical with flip on/off (golden test)
- [ ] pixelsPerHoop forwarded on both engine paths (regression test)
- [ ] Toggle in the drum inspector takes effect live

## S11 — Kit mirror X/Y `plumbing` `ui-light`

**Blocked by:** S10 (shares plumbing).

**What to build:** A kit-global mirror mode (none/x/y) applied as a final world-space reflection
in the pixel-model build (positions + tangents/normals consistently). Control on the Patch view
toolbar. Same invariant: geometry only, output stream untouched.

**Acceptance criteria:**
- [ ] Mirror reflects world coordinates; drums keep identity; mirror+flip compose (goldens)
- [ ] DMX map byte-identical regardless of mirror
- [ ] Toolbar control applies live and persists with the project
