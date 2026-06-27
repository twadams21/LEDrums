<script lang="ts">
  /* The "Name" rename field shared by every Patch per-node editor — a CommitInput bound to
     the node's display label, falling back to its derived title. Clears the override when
     blank or equal to the fallback (see forms.commitLabel). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import Field from '../../../ui/Field.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import { patchLabel, commitLabel } from './forms';

  let { store, nodeId, fallback }: { store: TriggerLab; nodeId: string; fallback: string } = $props();
</script>

<Field label="Name" hint="display label">
  <CommitInput
    value={patchLabel(store, nodeId, fallback)}
    autofocus={false}
    allowEmpty
    placeholder={fallback}
    ariaLabel="Node name"
    onCommit={(v) => commitLabel(store, nodeId, fallback, v)}
  />
</Field>
