<script lang="ts">
  /* One collapsible per-drum card in the Drums & Hoops pane: rename (on the `drum:<id>`
     zone id) + the drum transform (setDrumTransform — origin / rotation / colour / angles /
     spacing / diameter / flip, re-homed from PatchDrumInspector), the bound-trigger
     read-out, and the per-hoop rows (HoopRow). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import { hexToHsv, hsvToHex, type DrumConfig, type Hsv, type KitConfig } from '@ledrums/core';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import ColorSwatch from '../../../ui/ColorSwatch.svelte';
  import Field from '../../../ui/Field.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import ReadRow from '../../docks/inspectors/ReadRow.svelte';
  import RenameField from '../../docks/inspectors/RenameField.svelte';
  import { onNum, patchLabel } from '../../docks/inspectors/forms';
  import { boundTriggerFor, hoopPixelSpan } from '../../docks/patch-inspector';
  import { drumZoneId } from '../../patch-zones';
  import type { PatchRouting } from '../../patch-routing';
  import { drumPixelTotal, hoopIndices, pixelsForHoopIn } from './drums-hoops';
  import HoopRow from './HoopRow.svelte';
  import ListHead from '../../../ui/ListHead.svelte';

  let { store, drum, kit, routing }: {
    store: TriggerLab;
    drum: DrumConfig;
    kit: KitConfig;
    /** The authoritative routing (outputsToPatch(kit.outputs)) — feeds the hoop spans. */
    routing: PatchRouting;
  } = $props();

  const project = $derived(store.project);
  const nodeId = $derived(drumZoneId(drum.id));
  const fallback = $derived(drum.label || drum.id);
  const hoops = $derived(hoopIndices(drum, kit));
  const totalPx = $derived(drumPixelTotal(drum, kit));
  const pixelsForHoop = $derived(pixelsForHoopIn(kit));

  // The drum's persisted hex swatch through the HSV-based ColorSwatch primitive —
  // hsvToHex round-trips hexToHsv (core/color), so read + write stay lossless.
  const swatch = $derived<Hsv>(hexToHsv(drum.color ?? '#ffffff'));

  // Read-only: the trigger graph bound to this drum by identity, human-labelled when named.
  const bound = $derived(boundTriggerFor(drum.id, store.graphs));
  const boundLabel = $derived(bound ? store.graphLabel(bound.graphKey) : null);

  function setAxis(field: 'origin' | 'rotation', axis: 'x' | 'y' | 'z', n: number): void {
    store.setDrumTransform(drum.id, { [field]: { ...drum[field], [axis]: n } });
  }
</script>

<details class="drum">
  <summary>
    <ChevronRight class="chev" size={14} aria-hidden="true" />
    <span class="dname">{patchLabel(store, nodeId, fallback)}</span>
    <span class="dmeta">{hoops.length} hoops · {totalPx} px</span>
  </summary>
  <div class="body">
    <RenameField {store} {nodeId} {fallback} />
    <div class="vgroup">
      <span class="glabel">Origin <em>mm</em></span>
      <div class="axes">
        {#each ['x', 'y', 'z'] as const as ax (ax)}
          <CommitInput
            type="number"
            value={drum.origin[ax]}
            disabled={!project}
            suffix={ax}
            ariaLabel={`Origin ${ax}`}
            onCommit={(v) => onNum(v, (n) => setAxis('origin', ax, n))}
          />
        {/each}
      </div>
    </div>
    <div class="vgroup">
      <span class="glabel">Rotation <em>deg</em></span>
      <div class="axes">
        {#each ['x', 'y', 'z'] as const as ax (ax)}
          <CommitInput
            type="number"
            value={drum.rotation[ax]}
            disabled={!project}
            suffix={ax}
            ariaLabel={`Rotation ${ax}`}
            onCommit={(v) => onNum(v, (n) => setAxis('rotation', ax, n))}
          />
        {/each}
      </div>
    </div>
    <div class="set-grid">
    <Field label="Colour" info="Drum swatch.">
      <ColorSwatch
        hue={swatch.h}
        saturation={swatch.s}
        brightness={swatch.v}
        disabled={!project}
        ariaLabel="Drum colour"
        onChange={(hsv) => store.setDrumTransform(drum.id, { color: hsvToHex(hsv.h, hsv.s, hsv.v) })}
      />
    </Field>
    <Field label="Starting angle" info="All hoops.">
      <CommitInput
        type="number"
        value={drum.startAngleDeg}
        disabled={!project}
        suffix="°"
        ariaLabel="Starting angle"
        onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { startAngleDeg: n }))}
      />
    </Field>
    <Field label="Spin" info="Rotates pixel 0 around the hoop.">
      <CommitInput
        type="number"
        value={drum.localSpinDeg}
        disabled={!project}
        suffix="°"
        ariaLabel="Spin"
        onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { localSpinDeg: n }))}
      />
    </Field>
    <Field label="Hoop spacing" info="Vertical gap between hoops.">
      <CommitInput
        type="number"
        min={1}
        value={drum.hoopSpacingMm}
        disabled={!project}
        suffix="mm"
        ariaLabel="Hoop spacing"
        onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { hoopSpacingMm: n }))}
      />
    </Field>
    <Field label="Diameter" info="Drum size — sets ring radius.">
      <CommitInput
        type="number"
        min={1}
        value={drum.diameterIn}
        disabled={!project}
        suffix="in"
        ariaLabel="Diameter"
        onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { diameterIn: n }))}
      />
    </Field>
    <Field label="Flip drum" info="Rotate in place — mirror skins + reverse chase.">
      <Toggle
        pressed={drum.flip ?? false}
        disabled={!project}
        ariaLabel="Flip drum"
        onLabel="flipped"
        offLabel="normal"
        onChange={(v) => store.setDrumTransform(drum.id, { flip: v })}
      />
    </Field>
    </div>
    <ReadRow label="Bound trigger" value={boundLabel ?? bound?.label ?? '—'} />

    <ListHead label="Hoops" count={hoops.length} />
    <div class="hoopgrid" role="group" aria-label={`${patchLabel(store, nodeId, fallback)} hoops`}>
      <span class="hcol right">#</span>
      <span class="hcol">Hoop</span>
      <span class="hcol">Pixels</span>
      <span class="hcol">Reverse</span>
      <span class="hcol" aria-hidden="true"></span>
      <span class="hcol right">First / last px</span>
      {#each hoops as hoop (hoop)}
        <HoopRow {store} {drum} {kit} {hoop} span={hoopPixelSpan(routing, { drumId: drum.id, hoop }, pixelsForHoop)} />
      {/each}
    </div>
  </div>
</details>

<style>
  .drum {
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-2);
  }
  summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--ink);
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary :global(.chev) {
    flex: none;
    color: var(--text-faint);
    transition: rotate var(--dur-120) ease;
  }
  .drum[open] summary :global(.chev) {
    rotate: 90deg;
  }
  .dname {
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dmeta {
    margin-left: auto;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
    white-space: nowrap;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
    border-top: 1px solid var(--border-faint);
  }
  .vgroup {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .glabel {
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .glabel em {
    font-style: normal;
    color: var(--text-faint);
    margin-left: var(--space-1);
  }
  .axes {
    display: flex;
    gap: var(--space-2);
  }
  .axes :global(.ci) {
    flex: 1;
    min-width: 0;
  }
  /* Hoop rows: one shared column template; HoopRow cells join via display:contents. */
  .hoopgrid {
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 1fr) 6.5rem max-content max-content max-content;
    align-items: center;
    column-gap: var(--space-2);
    row-gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .hcol {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .hcol.right {
    text-align: right;
  }
</style>
