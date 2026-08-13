<script lang="ts">
  /* The unassigned-hoops pool — every kit hoop on no chain. It IS the `hoop-uncovered`
     indicator ("indicators, not restrictions"): an unwired hoop is legal, it just stays
     dark, so the chips warn rather than block.

     It is also both ends of the assignment gesture: a chip is a drag SOURCE (drop it on a
     chain to route it) and the pool is a drop TARGET (drop a chain row here to unroute it).
     Both reduce through the pane's `dropHoop`, the same path the picker and the remove
     button use — the drag is a gesture, not a second mutation route. */
  import ListHead from '../../../ui/ListHead.svelte';
  import TypeChip from '../../../ui/TypeChip.svelte';
  import { hoopKey, type HoopDrag } from './chain-editor';
  import { isHoopDrag, readHoopDrag, writeHoopDrag } from './hoop-dnd';
  import type { HoopRef } from '../../patch-routing';

  let {
    pool,
    labels,
    disabled = false,
    canEdit = true,
    onDropHoop,
  }: {
    pool: HoopRef[];
    labels: (h: HoopRef) => { drum: string; hoop: string; full: string };
    disabled?: boolean;
    canEdit?: boolean;
    /** A chain row dropped back here — unroute it. Pool-to-pool drags are no-ops upstream. */
    onDropHoop?: (drag: HoopDrag) => void;
  } = $props();

  let targeted = $state(false);
  const armed = $derived(canEdit && !disabled && onDropHoop !== undefined);

  function onDragOver(event: DragEvent): void {
    if (!armed || !isHoopDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    targeted = true;
  }
  function onDrop(event: DragEvent): void {
    const drag = readHoopDrag(event.dataTransfer);
    targeted = false;
    if (!armed || !drag) return;
    event.preventDefault();
    onDropHoop?.(drag);
  }
</script>

<section
  class="pool"
  class:targeted
  aria-label="Unassigned hoops"
  ondragover={onDragOver}
  ondragleave={() => (targeted = false)}
  ondrop={onDrop}
>
  <ListHead label="Unassigned hoops" count={pool.length} />
  {#if pool.length}
    <p class="phint">On no output chain — these hoops will stay dark. Drag one onto a chain to route it.</p>
    <div class="chips" role="list">
      {#each pool as h (hoopKey(h))}
        <span
          class="chip"
          role="listitem"
          draggable={armed}
          aria-label={`Drag ${labels(h).full}`}
          ondragstart={(e) => {
            writeHoopDrag(e.dataTransfer, { hoop: h, from: null });
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          }}
        >
          <TypeChip label={labels(h).drum} tint="var(--role-layer)" />
          <span class="cname">{labels(h).hoop}</span>
        </span>
      {/each}
    </div>
  {:else}
    <p class="phint">Every hoop is routed.</p>
  {/if}
</section>

<style>
  .pool {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px dashed var(--border-faint);
    border-radius: var(--radius-2);
    transition-property: border-color, background-color;
    transition-duration: var(--dur-120);
  }
  /* Dropping a routed hoop here unroutes it — say so before the mouse lets go. */
  .pool.targeted {
    border-color: color-mix(in oklch, var(--warn) 55%, transparent);
    background: color-mix(in oklch, var(--warn) 8%, transparent);
  }
  .phint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px var(--space-2) 2px var(--space-1);
    border: 1px solid color-mix(in oklch, var(--warn) 30%, transparent);
    border-radius: var(--radius-2);
    background: color-mix(in oklch, var(--warn) 7%, transparent);
    white-space: nowrap;
    cursor: grab;
    transition-property: border-color, background-color;
    transition-duration: var(--dur-120);
  }
  .chip:hover {
    border-color: color-mix(in oklch, var(--warn) 50%, transparent);
    background: color-mix(in oklch, var(--warn) 12%, transparent);
  }
  .chip:active {
    cursor: grabbing;
  }
  .cname {
    font-size: var(--text-xs);
    color: color-mix(in oklch, var(--warn) 55%, var(--text));
  }
</style>
