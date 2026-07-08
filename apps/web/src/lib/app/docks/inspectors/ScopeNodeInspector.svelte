<script lang="ts">
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import ScopeHoopPreview from './ScopeHoopPreview.svelte';
  import {
    commitSelection,
    describeSelection,
    effectiveScopeForNode,
    isPrimaryMultiSelect,
    selectionFromNode,
    toggleHoop,
    type ScopeSelection,
  } from './scope-inspector';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const drums = $derived(store.kitDrumInfos);
  const selection = $derived(selectionFromNode(node, drums));
  const selectedDrum = $derived(selection.kind === 'kit' ? (drums[0]?.id ?? 'kick') : selection.drumId);
  const drum = $derived(drums.find((d) => d.id === selectedDrum) ?? drums[0]);
  const drumOptions = $derived(drums.map((d) => ({ value: d.id, label: d.label })));
  const selectedHoops = $derived(selection.kind === 'hoops' ? selection.hoops : []);
  const localReadout = $derived(describeSelection(selection, drums));
  const effectiveReadout = $derived(effectiveScopeForNode(store.selectedGraph, node, drums));

  function commit(next: ScopeSelection): void {
    commitSelection(node, next, (n, scope) => store.setScope(n, scope), (n, targetId) => store.setTargetId(n, targetId));
  }

  function setWholeKit(on: boolean): void {
    if (on) commit({ kind: 'kit' });
    else commit({ kind: 'drum', drumId: selectedDrum });
  }

  function setDrum(drumId: string): void {
    commit({ kind: 'drum', drumId });
  }

  function selectWholeDrum(): void {
    commit({ kind: 'drum', drumId: selectedDrum });
  }

  function selectHoop(event: MouseEvent, hoop: number): void {
    const next = toggleHoop(selectedHoops, hoop, isPrimaryMultiSelect(event));
    commit({ kind: 'hoops', drumId: selectedDrum, hoops: next });
  }
</script>

<div class="body">
  <label class="toprow">
    <span>
      <span class="k">Whole Kit</span>
      <span class="sub">No-op route filter</span>
    </span>
    <Toggle pressed={selection.kind === 'kit'} onChange={setWholeKit} ariaLabel="Whole kit scope" />
  </label>

  {#if selection.kind !== 'kit' && drum}
    <div class="drumrow">
      <span class="k">Drum</span>
      <SegmentedControl value={selectedDrum} options={drumOptions} onChange={setDrum} ariaLabel="Scope drum" />
    </div>

    <ScopeHoopPreview
      label={drum.label}
      hoopCount={drum.hoopCount}
      selectedHoops={selectedHoops}
      whole={selection.kind === 'drum'}
      onSelectHoop={selectHoop}
    />

    <button class="whole-drum" type="button" onclick={selectWholeDrum}>Whole Drum</button>
  {/if}

  <div class="readouts">
    <section class={['readout', localReadout.empty && 'empty']}>
      <span class="k">Local</span>
      <strong>{localReadout.label}</strong>
      <span>{localReadout.detail}</span>
    </section>
    <section class={['readout', effectiveReadout.empty && 'empty', effectiveReadout.noOp && 'noop']}>
      <span class="k">Effective</span>
      <strong>{effectiveReadout.label}</strong>
      <span>{effectiveReadout.detail}</span>
    </section>
  </div>
</div>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .toprow,
  .drumrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .toprow {
    justify-content: space-between;
  }
  .toprow > span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .drumrow > :global(.seg) {
    flex: 1;
    min-width: 0;
  }
  .k {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 600;
  }
  .sub {
    color: var(--text-faint);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
  }
  .whole-drum {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    transition-property: color, border-color, scale;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .whole-drum:hover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 55%, var(--border));
  }
  .whole-drum:active {
    scale: 0.96;
  }
  .readouts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .readout {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-2);
    background: var(--surface-inset);
    border-radius: var(--radius-1);
  }
  .readout strong {
    color: var(--ink);
    font-size: var(--text-xs);
  }
  .readout span:last-child {
    color: var(--text-faint);
    font-size: var(--text-2xs);
    line-height: var(--leading-normal);
  }
  .readout.empty strong,
  .readout.empty span:last-child {
    color: var(--live);
  }
  .readout.noop span:last-child {
    color: var(--text-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .whole-drum {
      transition: none;
    }
  }
</style>
