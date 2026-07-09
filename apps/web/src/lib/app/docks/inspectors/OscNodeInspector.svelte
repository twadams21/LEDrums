<script lang="ts">
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import NodeSignalPreview from '../../views/NodeSignalPreview.svelte';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();
  const address = $derived(store.oscNodeAddress(node));
</script>

{#if node.kind === 'osc'}
  <div class="kindbody">
    <figure class="preview">
      <NodeSignalPreview kind="osc" ccValue={() => store.oscNodeLiveValue(node)} w={188} h={30} />
      <figcaption>Live value</figcaption>
    </figure>
    <Field layout="row" label="OSC address" hint="e.g. /fader/1">
      <CommitInput
        type="text"
        value={address}
        placeholder="/address"
        ariaLabel="OSC address"
        autofocus={false}
        onCommit={(v) => store.setOscNodeAddress(node, String(v))}
      />
    </Field>
    <p class="hint">
      This address drives every parameter it's wired to, live on all voices. Set wire depth,
      invert and range on the target node's Parameters section.
    </p>
  </div>
{/if}

<style>
  .kindbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
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
