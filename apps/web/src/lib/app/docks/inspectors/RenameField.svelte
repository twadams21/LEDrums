<script lang="ts">
  /* The "Name" rename field shared by every per-node editor — a CommitInput bound to the
     node's display label, falling back to its derived title. Clears the override when blank
     or equal to the fallback (see forms.commitLabel).

     `bare` drops the built-in Field wrapper so a caller can place the input in its own field
     grid (Settings does: label above, fields in columns) without nesting two labels. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import { patchLabel, commitLabel } from './forms';

  let {
    store,
    nodeId,
    fallback,
    bare = false,
  }: { store: TriggerLab; nodeId: string; fallback: string; bare?: boolean } = $props();
</script>

{#snippet input()}
  <CommitInput
    value={patchLabel(store, nodeId, fallback)}
    autofocus={false}
    allowEmpty
    placeholder={fallback}
    ariaLabel="Node name"
    onCommit={(v) => commitLabel(store, nodeId, fallback, v)}
  />
{/snippet}

{#if bare}
  {@render input()}
{:else}
  <Field label="Name">{@render input()}</Field>
{/if}
