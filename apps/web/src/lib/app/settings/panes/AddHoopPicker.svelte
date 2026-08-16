<script lang="ts">
  /* "Add hoop" picker for one output chain — a Select fed ONLY by the unassigned pool, so
     adding a hoop that is already chained is impossible by construction (the list-editor
     twin of the canvas' single-upstream rule). Picking appends via `onAdd` and resets to
     the placeholder. Values ride the existing `hoop:<drumId>:<n>` node-id grammar. */
  import Select from '../../../ui/Select.svelte';
  import { hoopNodeId, parseHoopNodeId } from '../../patch-graph';
  import type { HoopRef } from '../../patch-routing';

  let {
    pool,
    hoopLabel,
    disabled = false,
    onAdd,
  }: {
    pool: HoopRef[];
    hoopLabel: (h: HoopRef) => string;
    disabled?: boolean;
    onAdd: (h: HoopRef) => void;
  } = $props();

  let value = $state('');
  const options = $derived(pool.map((h) => ({ value: hoopNodeId(h), label: hoopLabel(h) })));

  function pick(v: string): void {
    const ref = parseHoopNodeId(v);
    value = ''; // back to the placeholder — this is an action picker, not a persistent value
    if (ref) onAdd(ref);
  }
</script>

<Select bind:value {options} placeholder="Add hoop…" ariaLabel="Add hoop to chain" {disabled} onChange={pick} class="addhoop" />
