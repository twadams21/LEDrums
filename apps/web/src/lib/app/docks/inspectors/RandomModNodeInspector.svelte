<script lang="ts">
  import type { voice } from '@ledrums/core';
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import NodeSignalPreview from '../../views/NodeSignalPreview.svelte';
  import { onNum } from './forms';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const distribution = $derived(store.randomDistribution(node));
  const steps = $derived(store.randomSteps(node));
  const DIST_OPTS: { value: voice.RandomDistribution; label: string }[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'gaussian', label: 'Gaussian' },
    { value: 'exponential', label: 'Exponential' },
    { value: 'logarithmic', label: 'Logarithmic' },
    { value: 'triangular', label: 'Triangular' },
    { value: 'beta', label: 'Beta' },
    { value: 'stepped', label: 'Stepped' },
  ];
</script>

{#if node.kind === 'randomMod'}
  <div class="kindbody">
    <figure class="preview">
      <NodeSignalPreview kind="random" {distribution} {steps} w={228} h={72} />
      <figcaption>Distribution curve</figcaption>
    </figure>
    <Field layout="row" label="Distribution">
      <Select
        value={distribution}
        options={DIST_OPTS}
        onChange={(v) => store.setRandomDistribution(node, v as voice.RandomDistribution)}
        ariaLabel="Random distribution"
      />
    </Field>
    {#if distribution === 'stepped'}
      <Field layout="row" label="Steps" hint="2-64">
        <CommitInput
          type="number"
          min={2}
          max={64}
          value={steps}
          ariaLabel="Random stepped count"
          onCommit={(v) => onNum(v, (n) => store.setRandomSteps(node, n))}
        />
      </Field>
    {/if}
  </div>
{/if}

<style>
  .kindbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .kindbody :global(.sel) {
    width: 100%;
  }
  .preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
  }
  figcaption {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
