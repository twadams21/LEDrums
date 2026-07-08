<script lang="ts">
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, Scope } from '../../../trigger-lab/sim';
  import { SCOPE_OPTS } from '../../views/node-options';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const targetOptions = $derived.by(() => {
    const infos = store.kitDrumInfos;
    if (node.scope === 'drum') return infos.map((d) => ({ value: d.id, label: d.label }));
    if (node.scope === 'hoop') {
      return infos.flatMap((d) =>
        Array.from({ length: d.hoopCount }, (_, i) => ({
          value: `${d.id}#${i}`,
          label: `${d.label} · Hoop ${i}`,
        })),
      );
    }
    return [];
  });
</script>

<div class="body">
  <div class="row">
    <span class="k">Scope</span>
    <SegmentedControl
      value={node.scope}
      options={SCOPE_OPTS}
      onChange={(v) => store.setScope(node, v as Scope)}
      ariaLabel="Output scope"
    />
  </div>

  {#if node.scope !== 'kit'}
    <div class="row">
      <span class="k">Target</span>
      <Select
        value={node.targetId ?? ''}
        options={targetOptions}
        onChange={(v) => store.setTargetId(node, v || undefined)}
        placeholder="Auto (firing drum)"
        ariaLabel="Output target"
      />
    </div>
  {/if}
</div>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .k {
    width: var(--field-label-col);
    color: var(--text-muted);
    font-weight: 500;
    font-size: var(--text-2xs);
    white-space: nowrap;
  }
  .row :global(.select-trigger) {
    flex: 1;
    min-width: 0;
  }
</style>
