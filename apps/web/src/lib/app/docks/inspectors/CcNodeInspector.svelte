<script lang="ts">
  /* CONTROLLER SOURCE node editor (doc 10, S37 + OSC) — the node reads a live 0..1 value from one
     of two inputs and drives every parameter it's wired to (depth + range are per-mapping, edited
     on the TARGET node's Parameters section). A source toggle picks the input: MIDI Control Change
     (controller number + channel filter, plus MIDI-learn; controller 0 is reserved for section
     recall and rejected) or an OSC address. Composed from the design-system primitives
     (Field / Select / CommitInput / SegmentedControl). */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Radio from '@lucide/svelte/icons/radio';
  import { onNum } from './forms';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const source = $derived(store.ccNodeSource(node));
  const controller = $derived(store.ccNodeController(node));
  const channel = $derived(store.ccNodeChannel(node));
  const oscAddress = $derived(store.oscNodeAddress(node));
  const learning = $derived(store.midiLearnTarget?.kind === 'cc-node' && store.midiLearnTarget.nodeId === node.id);

  const SOURCE_OPTS = [
    { value: 'midi', label: 'MIDI CC' },
    { value: 'osc', label: 'OSC' },
  ];

  // Omni + channels 1..16 — value is the channel string, 'omni' maps to a null filter.
  const CHANNEL_OPTS = [
    { value: 'omni', label: 'Any (omni)' },
    ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `Ch ${i + 1}` })),
  ];

  function onChannel(v: string): void {
    store.setCcChannel(node, v === 'omni' ? null : Number(v));
  }
  function onSource(v: string): void {
    if (learning) store.cancelMidiLearn(); // leaving MIDI mode ends any in-flight learn
    store.setCcNodeSource(node, v === 'osc' ? 'osc' : 'midi');
  }
</script>

{#if node.kind === 'cc'}
  <div class="kindbody">
    <Field layout="row" label="Source">
      <SegmentedControl value={source} options={SOURCE_OPTS} onChange={onSource} ariaLabel="Modulation input source" />
    </Field>

    {#if source === 'osc'}
      <Field layout="row" label="OSC address" hint="e.g. /fader/1">
        <CommitInput
          type="text"
          value={oscAddress}
          placeholder="/address"
          ariaLabel="OSC address"
          autofocus={false}
          onCommit={(v) => store.setOscNodeAddress(node, String(v))}
        />
      </Field>
      <p class="hint">
        This address drives every parameter it's wired to, live on all voices — its incoming 0..1
        value is the source signal. Set a wire's depth, invert and range on the target node's
        Parameters section.
      </p>
    {:else}
      <Field layout="row" label="CC number" hint="1-127">
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
      <Field layout="row" label="Channel">
        <Select value={channel === null ? 'omni' : String(channel)} options={CHANNEL_OPTS} onChange={onChannel} ariaLabel="MIDI channel filter" />
      </Field>
      <p class="hint">
        This controller drives every parameter it's wired to, live on all voices. Set a wire's depth,
        invert and range on the target node's Parameters section. CC 0 is reserved for section recall.
      </p>
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
