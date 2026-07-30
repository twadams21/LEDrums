# Lane: INIT-09 chunk 09B — structural collapses + styleguide (S5–S8)

Read `lanes/COMMON.md` and the **Chunk 09B** section of `lanes/init09-chunks.md` —
both bind. Branch: `init/09b-structural` off `review/impl` (start at origin
HEAD; re-measure baseline at your starting HEAD and report it). Steps from
`09-synthesis/INIT-09-ui-component-dedup.json`: S5→S6→S7→S8 (S8 LAST — it is
the styleguide sweep that certifies the rest).

09A landed (S0–S4): visual baseline frozen (archive path in the 09A report),
ActionButton / InspectorHeader / MidiLearnRow extracted, canvas-visibility
runes shared, six presets added. Its corrections bind you:
- PatchZoneInspector.svelte is DELETED (D5) — any step naming it is stale.
- `trigger-source-inspector` as a preset name is stale — that surface is
  captured by `midi-learn-trigger-source`.
- The styleguide `?style` route was repaired in S0 (pillStub drift); it is the
  acceptance surface for controller-state work — keep it rendering.

- S5: inline Overlays.svelte into App.svelte and delete it.
- S6: one ControlProps<T> contract for the eight design-system primitives,
  documented where the primitives are documented.
- S7: split ControllerStatusPanel along the five axes its history moves on,
  each child carrying its scoped CSS. Pixel-diff each child surface against
  the 09A baseline (controller:discover / :auth / :needs states have
  presets; StatusDot pulse noise ~1.5k px is the known floor).
- S8 LAST: register the controller children in the styleguide + sweep +
  `pnpm design-system` regeneration IN THE SAME CHANGE.
- Inherited residue (small, in-fence):
  · PlayNodeInspector.svelte:77 hand-builds `${d.id}#${i + 1}` option values —
    route through core's format helper (06A reviewer NB; 06B fixed
    OutputNodeInspector, this file was yours to finish).
  · While in the styleguide: 09A found `as unknown as TriggerLab` stubs can
    hide store-shape drift invisibly (the pillStub bug). If S8's sweep finds
    another stub missing members its component reads, fix it and say so.
- UI non-negotiables: /make-interfaces-feel-better; ui-shot with UI_SHOT_BASE
  pinned to YOUR OWN dev server (LEDRUMS_WEB_PORT=4326 / LEDRUMS_WS_PORT=4327
  worked for 09A; pool ports serve production builds where shot-seam is dead).
  Kill the dev stack when done. Disk is tight — no cargo builds.
- Gates green per committed step. Report: per-step shas, gates numbers,
  pixel-diff table, deviations.
