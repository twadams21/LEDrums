<script lang="ts">
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, Scope } from '../../../trigger-lab/sim';
  import { voice } from '@ledrums/core';
  import { SCOPE_OPTS } from '../../views/node-options';
  import { lintEntries, type LintEntry } from '../../views/graph-lint';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import Field from '../../../ui/Field.svelte';
  import AnchorHeader from '../../../ui/AnchorHeader.svelte';
  import CircleDot from '@lucide/svelte/icons/circle-dot';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  // Empty-scope state (R06): the render-plan compiler flags an Output whose scope can never
  // intersect the layers reaching it — the same finding the lint strip + node badge show, so
  // the author sees a consistent story on the canvas and here. Reuses the shared lint copy.
  const emptyScope = $derived.by<LintEntry | null>(() => {
    const graph = store.selectedGraph;
    if (!graph) return null;
    const entry = lintEntries(voice.compileRenderPlan(graph).issues).find(
      (e) => e.code === 'empty-scope' && e.nodeId === node.id,
    );
    return entry ?? null;
  });

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

<!-- output is a protected graph anchor (like the trigger root): no kind selector, no remove —
     it gets a title-block header instead of the shared node header the dispatcher hosts. -->
<AnchorHeader icon={CircleDot} tint="var(--role-output)" title="Output" sub="graph output — every layer lands here" />

<div class="body">
  {#if emptyScope}
    <!-- Empty-scope row — warn (guides authoring), never the red fault alarm. Same copy as the
         strip + node badge so the finding reads identically everywhere. -->
    <div class="empty-scope" role="status">
      <TriangleAlert size={14} class="es-glyph" aria-hidden="true" />
      <p class="es-copy">
        <span class="es-problem">{emptyScope.problem}.</span>
        <span class="es-action">{emptyScope.action}</span>
      </p>
    </div>
  {/if}

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
        placeholder="Auto (firing drum)"
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
  /* empty-scope callout — warn-toned, icon + text so the tone never lives in colour alone.
     Mirrors the graph lint strip's row so the surfaces read as one system. */
  .empty-scope {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid color-mix(in oklch, var(--warn) 45%, transparent);
    border-radius: var(--radius-2);
    background: color-mix(in oklch, var(--warn) 12%, var(--surface-3));
  }
  .empty-scope :global(.es-glyph) {
    flex: none;
    color: var(--warn);
    margin-top: 1px;
  }
  .es-copy {
    margin: 0;
    min-width: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    text-wrap: pretty;
  }
  .es-problem {
    color: var(--text);
    font-weight: 550;
  }
  .es-action {
    color: var(--text-muted);
  }
</style>
