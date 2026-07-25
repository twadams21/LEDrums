<script lang="ts">
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, Scope } from '../../../trigger-lab/sim';
  import { voice } from '@ledrums/core';
  import { SCOPE_OPTS } from '../../views/node-options';
  import { nodeLintEntries } from '../../views/graph-lint';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import Field from '../../../ui/Field.svelte';
  import AnchorHeader from '../../../ui/AnchorHeader.svelte';
  import LintCallout from '../../../ui/LintCallout.svelte';
  import CircleDot from '@lucide/svelte/icons/circle-dot';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  // Render-plan findings anchored to this Output (R06 + R15): empty-scope (a scope that can never
  // intersect the layers reaching it) and dead-branch (reaches Output but has no producer upstream).
  // Same findings the lint strip + node badge show, so the author sees one consistent story. Compiled
  // uncached (per the render-plan cache contract — empty-scope is param-derived).
  const lint = $derived.by(() => {
    const graph = store.selectedGraph;
    if (!graph) return [];
    return nodeLintEntries(voice.compileRenderPlan(graph).issues, node.id, ['empty-scope', 'dead-branch']);
  });

  const targetOptions = $derived.by(() => {
    const infos = store.kitDrumInfos;
    if (node.scope === 'drum') return infos.map((d) => ({ value: d.id, label: d.label }));
    if (node.scope === 'hoop') {
      return infos.flatMap((d) =>
        Array.from({ length: d.hoopCount }, (_, i) => ({
          value: `${d.id}#${i + 1}`,
          label: `${d.label} · Hoop ${i + 1}`,
        })),
      );
    }
    return [];
  });
</script>

<!-- output is a protected graph anchor (like the trigger root): no kind selector, no remove —
     it gets a title-block header instead of the shared node header the dispatcher hosts. -->
<AnchorHeader icon={CircleDot} tint="var(--role-output)" title="Output" sub="where all effects combine" />

<div class="body">
  {#each lint as entry (entry.code)}
    <LintCallout problem={entry.problem} action={entry.action} />
  {/each}

  <Field layout="row" label="Scope">
    <SegmentedControl
      value={node.scope}
      options={SCOPE_OPTS}
      onChange={(v) => store.setScope(node, v as Scope)}
      ariaLabel="Output scope"
    />
  </Field>

  {#if node.scope !== 'kit'}
    <Field layout="row" label="Target">
      <Select
        value={node.targetId ?? ''}
        options={targetOptions}
        onChange={(v) => store.setTargetId(node, v || undefined)}
        placeholder="Auto (triggering drum)"
        ariaLabel="Output target"
      />
    </Field>
  {/if}
</div>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
</style>
