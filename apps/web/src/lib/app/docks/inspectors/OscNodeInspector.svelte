<script lang="ts">
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();
  const address = $derived(store.oscNodeAddress(node));
</script>

{#if node.kind === 'osc'}
  <div class="kindbody">
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
</style>
