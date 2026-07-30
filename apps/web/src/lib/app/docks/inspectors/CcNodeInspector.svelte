<script lang="ts">
  /* MIDI CC modulation source editor. OSC is now its own source node. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import MidiLearnRow from '../../../ui/MidiLearnRow.svelte';
  import { onNum } from './forms';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const controller = $derived(store.ccNodeController(node));
  const channel = $derived(store.ccNodeChannel(node));
  const learning = $derived(store.midi.learnTarget?.kind === 'cc-node' && store.midi.learnTarget.nodeId === node.id);

  // Omni + channels 1..16 — value is the channel string, 'omni' maps to a null filter.
  const CHANNEL_OPTS = [
    { value: 'omni', label: 'Any (omni)' },
    ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `Ch ${i + 1}` })),
  ];

  function onChannel(v: string): void {
    store.setCcChannel(node, v === 'omni' ? null : Number(v));
  }
</script>

{#if node.kind === 'cc'}
  <div class="kindbody">
    <Field layout="row" label="CC number" hint="1-127">
      <MidiLearnRow
        {learning}
        onToggle={() =>
          learning ? store.midi.cancelLearn() : store.midi.startLearn({ kind: 'cc-node', nodeId: node.id })}
      >
        <CommitInput
          type="number"
          min={1}
          max={127}
          value={controller}
          placeholder="1-127"
          ariaLabel="CC controller number"
          onCommit={(v) => onNum(v, (n) => store.setCcController(node, n))}
        />
      </MidiLearnRow>
    </Field>
    <Field layout="row" label="Channel">
      <Select value={channel === null ? 'omni' : String(channel)} options={CHANNEL_OPTS} onChange={onChannel} ariaLabel="MIDI channel filter" />
    </Field>
    <p class="hint">
      This controller drives every parameter it's wired to, live on all voices. Set a wire's depth,
      invert and range on the target node's Parameters section. CC 0 is reserved for section recall.
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
  .kindbody :global(.sel) {
    width: 100%;
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
</style>
