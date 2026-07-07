<script lang="ts">
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import {
    commitSelection,
    describeSelection,
    effectiveScopeForNode,
    hoopLabel,
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

    <section class={['preview', drum.id === 'kick' && 'sideways']} aria-label={`${drum.label} hoop selector`}>
      <div class="rings">
        {#each Array.from({ length: drum.hoopCount }, (_, i) => i) as hoop (hoop)}
          <button
            type="button"
            class={[
              'hoop',
              selection.kind === 'drum' && 'whole',
              selection.kind === 'hoops' && selectedHoops.includes(hoop) && 'selected',
            ]}
            style:--i={hoop}
            style:--count={drum.hoopCount}
            onclick={(event) => selectHoop(event, hoop)}
            aria-pressed={selection.kind === 'drum' || selectedHoops.includes(hoop)}
            aria-label={`${drum.label} ${hoopLabel(hoop)}`}
          >
            <span>{hoopLabel(hoop)}</span>
          </button>
        {/each}
        <div class="core">{drum.label}</div>
      </div>
    </section>

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
  .preview {
    position: relative;
    min-height: 220px;
    display: grid;
    place-items: center;
    overflow: hidden;
    background:
      radial-gradient(circle at 50% 50%, color-mix(in oklch, var(--role-output) 13%, transparent), transparent 58%),
      var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, white 4%, transparent);
  }
  .rings {
    position: relative;
    width: min(190px, 78%);
    aspect-ratio: 1;
  }
  .sideways .rings {
    transform: scaleX(1.34);
  }
  .hoop {
    position: absolute;
    inset: calc(var(--i) * 12%);
    display: grid;
    place-items: start center;
    padding-top: 7px;
    min-width: 40px;
    min-height: 40px;
    color: var(--text-faint);
    background: color-mix(in oklch, var(--surface-2) 72%, transparent);
    border: 1px solid color-mix(in oklch, var(--role-output) 28%, var(--border));
    border-radius: 50%;
    cursor: pointer;
    transition-property: background-color, border-color, color, scale, box-shadow;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .hoop span {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    background: var(--surface-1);
    border-radius: var(--radius-pill);
    padding: 1px 6px;
  }
  .hoop:hover {
    color: var(--ink);
    border-color: var(--role-output);
  }
  .hoop:active {
    scale: 0.96;
  }
  .hoop.selected,
  .hoop.whole {
    color: var(--ink);
    background: color-mix(in oklch, var(--role-output) 22%, var(--surface-inset));
    border-color: var(--role-output);
    box-shadow: 0 0 0 1px color-mix(in oklch, var(--role-output) 24%, transparent);
  }
  .core {
    position: absolute;
    inset: 42%;
    display: grid;
    place-items: center;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 700;
    text-align: center;
  }
  .sideways .core,
  .sideways .hoop span {
    transform: scaleX(0.75);
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
    color: var(--danger);
  }
  .readout.noop span:last-child {
    color: var(--text-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .hoop,
    .whole-drum {
      transition: none;
    }
  }
</style>
