<script lang="ts">
  /* CC SOURCE node editor (doc 10, S37) — the node reads a live MIDI Control Change and drives
     every parameter it's wired to (depth + range are per-mapping, edited on the TARGET node's
     Parameters section, so this inspector is just the controller number + channel filter, plus
     MIDI-learn). Controller 0 is reserved for global section recall and rejected here. Composed
     from the design-system primitives (Field / Select / CommitInput). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Radio from '@lucide/svelte/icons/radio';
  import { onNum } from './forms';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const controller = $derived(store.ccNodeController(node));
  const channel = $derived(store.ccNodeChannel(node));
  const learning = $derived(store.midiLearnTarget?.kind === 'cc-node' && store.midiLearnTarget.nodeId === node.id);

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
    <Field label="CC number" hint="1-127">
      <div class="cc-row">
        <CommitInput
          type="number"
          min={1}
          max={127}
          value={controller}
          placeholder="1-127"
          ariaLabel="CC controller number"
          onCommit={(v) => onNum(v, (n) => store.setCcController(node, n))}
        />
        <button
          type="button"
          class="learn"
          class:active={learning}
          onclick={(e) => {
            e.preventDefault();
            learning ? store.cancelMidiLearn() : store.startMidiLearn({ kind: 'cc-node', nodeId: node.id });
          }}
        >
          <Radio size={13} aria-hidden="true" />
          {learning ? 'Listening' : 'Learn'}
        </button>
      </div>
    </Field>
    <Field label="Channel">
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
  .cc-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
  }
  .learn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 29px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 600;
    white-space: nowrap;
  }
  .learn:hover,
  .learn.active {
    border-color: var(--accent);
    color: var(--ink);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
</style>
