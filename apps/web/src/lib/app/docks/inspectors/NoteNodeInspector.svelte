<script lang="ts">
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import { onNum } from './forms';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const note = $derived(store.noteNodeNumber(node));
  const channel = $derived(store.noteNodeChannel(node));
  const mode = $derived(store.noteNodeMode(node));
  const releaseMs = $derived(store.noteNodeReleaseMs(node));

  const CHANNEL_OPTS = [
    { value: 'omni', label: 'Any (omni)' },
    ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `Ch ${i + 1}` })),
  ];
  const MODE_OPTS = [
    { value: 'gate', label: 'Gate' },
    { value: 'velocity', label: 'Velocity' },
  ];
</script>

{#if node.kind === 'note'}
  <div class="kindbody">
    <Field layout="row" label="Note" hint="0-127">
      <CommitInput
        type="number"
        min={0}
        max={127}
        value={note}
        ariaLabel="MIDI note number"
        onCommit={(v) => onNum(v, (n) => store.setNoteNodeNumber(node, n))}
      />
    </Field>
    <Field layout="row" label="Channel">
      <Select
        value={channel === null ? 'omni' : String(channel)}
        options={CHANNEL_OPTS}
        onChange={(v) => store.setNoteNodeChannel(node, v === 'omni' ? null : Number(v))}
        ariaLabel="MIDI note channel"
      />
    </Field>
    <Field layout="row" label="Mode">
      <Select value={mode} options={MODE_OPTS} onChange={(v) => store.setNoteNodeMode(node, v === 'velocity' ? 'velocity' : 'gate')} ariaLabel="Note output mode" />
    </Field>
    <Field layout="row" label="Release" hint="ms">
      <CommitInput
        type="number"
        min={0}
        value={releaseMs}
        ariaLabel="Note gate release milliseconds"
        onCommit={(v) => onNum(v, (n) => store.setNoteNodeReleaseMs(node, n))}
      />
    </Field>
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
</style>
