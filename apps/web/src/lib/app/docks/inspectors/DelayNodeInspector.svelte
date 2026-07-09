<script lang="ts">
  /* Delay-node editor — mode selector (Time / Division), ms numeric input or division
     select depending on mode. The shared node header (kind selector + remove) lives in
     the parent Inspector; this renders only the delay-specific controls. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Select from '../../../ui/Select.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Field from '../../../ui/Field.svelte';
  import { DELAY_MODE_OPTS, DIVISION_OPTS } from '../../views/node-options';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();
</script>

{#if node.kind === 'delay'}
  <div class="kindbody">
    <Field layout="row" label="Mode">
      <SegmentedControl
        value={node.delayMode}
        options={DELAY_MODE_OPTS}
        onChange={(v) => store.setDelayMode(node, v as 'time' | 'beats')}
        ariaLabel="Delay mode"
      />
    </Field>

    {#if node.delayMode === 'time'}
      <Field layout="row" label="Time" unit="ms">
        <CommitInput
          type="number"
          value={node.ms}
          min={0}
          max={60000}
          step={1}
          onCommit={(v) => store.setDelayMs(node, Number(v))}
          ariaLabel="Delay milliseconds"
        />
      </Field>
    {:else}
      <Field layout="row" label="Division">
        <Select
          value={node.division}
          options={DIVISION_OPTS}
          onChange={(v) => store.setDivision(node, v)}
          ariaLabel="Delay division"
        />
      </Field>
    {/if}

    <p class="hint">Children fire this long after the trigger. Wire them below the delay node on the canvas.</p>
  </div>
{/if}

<style>
  .kindbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
</style>
