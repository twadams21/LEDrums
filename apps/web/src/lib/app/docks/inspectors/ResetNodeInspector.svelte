<script lang="ts">
  /* Reset-node editor — pick the sequence node this reset snaps back to its first step.

     Two cascading selects (graph, then sequence node within it) rather than one flat list,
     because a show carries a graph per pad zone and the flat product gets long fast. The target
     is stored as (graph key, node id); the graph select alone is not a valid target, so picking a
     graph auto-selects its first sequence node — you can never leave the node half-set.

     Only graphs that actually CONTAIN a sequence node are listed: there is nothing to reset in the
     others. If the show has none at all, the picker is replaced by an explanation rather than an
     empty dropdown. The shared node header (kind selector + remove) lives in the parent Inspector. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Select from '../../../ui/Select.svelte';
  import Field from '../../../ui/Field.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import Radio from '@lucide/svelte/icons/radio';
  import { resetTargetOptions, sequenceNodesOf, describeResetTarget } from '../../views/reset-target';
  import { formatMidiNote, parseMidiNote } from '../../../midi/midi-note';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  /* --- how this reset is fired -------------------------------------------------------------
     Unbound, it behaves as a plain inline node: whatever reaches it through the graph's Trigger
     resets. Bound to its own MIDI note / OSC address, it becomes an independent entry point — the
     footswitch case — and then it deliberately STOPS resetting on ordinary flow, so it can live in
     the same graph as its target without wiping the sequence on every hit. */
  const FIRE_OPTS = [
    { value: 'flow', label: 'Trigger' },
    { value: 'midi', label: 'MIDI' },
    { value: 'osc', label: 'OSC' },
  ];
  const fireMode = $derived(node.source?.kind === 'midi' ? 'midi' : node.source?.kind === 'osc' ? 'osc' : 'flow');
  const learning = $derived(store.midiLearnTarget?.kind === 'reset-node' && store.midiLearnTarget.nodeId === node.id);

  function setFireMode(mode: string): void {
    if (mode === 'flow') store.setResetSource(node, null);
    else if (mode === 'midi') store.setResetSource(node, node.source?.kind === 'midi' ? node.source : { kind: 'midi', note: 60 });
    else store.setResetSource(node, node.source?.kind === 'osc' ? node.source : { kind: 'osc', address: '' });
  }

  const options = $derived(resetTargetOptions(store.graphs, Object.keys(store.graphs), (k) => store.graphLabel(k)));
  /** Graph choices, de-duplicated in option order (a graph appears once per sequence node above). */
  const graphOpts = $derived(
    [...new Map(options.map((o) => [o.graphKey, o.graphLabel])).entries()].map(([value, label]) => ({ value, label })),
  );
  const nodeOpts = $derived(
    sequenceNodesOf(store.graphs[node.targetGraphKey ?? '']).map((n) => ({ value: n.nodeId, label: n.nodeLabel })),
  );
  const summary = $derived(describeResetTarget(node, options));
  /** A stored target whose graph or node has since been deleted — surfaced, since eval just skips it. */
  const dangling = $derived(!!node.targetGraphKey && !!node.targetNodeId && summary === 'target missing');

  /** Picking a graph selects its first sequence node, so the pair is never half-set. */
  function pickGraph(graphKey: string): void {
    store.setResetTarget(node, graphKey, sequenceNodesOf(store.graphs[graphKey])[0]?.nodeId ?? null);
  }
</script>

{#if node.kind === 'reset'}
  <div class="kindbody">
    {#if !options.length}
      <p class="hint">
        This show has no sequence nodes yet. Add a Sequence node to a graph, then come back and point this reset at it.
      </p>
    {:else}
      <Field label="Graph">
        <Select
          value={node.targetGraphKey ?? ''}
          options={graphOpts}
          placeholder="Choose a graph"
          onChange={(v) => pickGraph(v)}
          ariaLabel="Reset target graph"
        />
      </Field>

      <Field label="Sequence">
        <Select
          value={node.targetNodeId ?? ''}
          options={nodeOpts}
          placeholder={node.targetGraphKey ? 'Choose a sequence' : 'Choose a graph first'}
          disabled={!nodeOpts.length}
          onChange={(v) => store.setResetTarget(node, node.targetGraphKey ?? null, v)}
          ariaLabel="Reset target sequence node"
        />
      </Field>

      {#if dangling}
        <p class="warn">That target no longer exists — this reset currently does nothing. Pick another.</p>
      {/if}

      <div class="firesection">
        <Field label="Fired by">
          <SegmentedControl value={fireMode} options={FIRE_OPTS} onChange={setFireMode} ariaLabel="What fires this reset" />
        </Field>

        {#if node.source?.kind === 'midi'}
          {@const src = node.source}
          <Field layout="row" label="Note" hint={src.note === undefined ? 'C-1 - G9' : String(src.note)}>
            <div class="note-row">
              <CommitInput
                value={src.note === undefined ? '' : formatMidiNote(src.note)}
                placeholder="C4"
                autofocus={false}
                mono
                ariaLabel="Reset MIDI note"
                onCommit={(v) => {
                  const parsed = parseMidiNote(v);
                  if (parsed !== null) store.setResetSource(node, { kind: 'midi', note: parsed });
                }}
              />
              <button
                type="button"
                class="learn"
                class:active={learning}
                onclick={(e) => {
                  e.preventDefault();
                  learning ? store.cancelMidiLearn() : store.startMidiLearn({ kind: 'reset-node', nodeId: node.id });
                }}
              >
                <Radio size={13} aria-hidden="true" />
                {learning ? 'Listening' : 'Learn'}
              </button>
            </div>
          </Field>
          <p class="hint">Press your footswitch with Learn armed to bind it.</p>
        {:else if node.source?.kind === 'osc'}
          <Field layout="row" label="Address" hint="e.g. /reset">
            <CommitInput
              value={node.source.address}
              mono
              autofocus={false}
              placeholder="/reset"
              ariaLabel="Reset OSC address"
              onCommit={(v) => store.setResetSource(node, { kind: 'osc', address: v.trim() })}
            />
          </Field>
        {/if}
      </div>

      <p class="hint">
        {#if node.targetGraphKey && node.targetNodeId && !dangling}
          Resets <strong>{summary}</strong> to its first step, then passes the trigger on to its own children.
        {:else}
          Pick the sequence this snaps back to its first step. It passes the trigger on to its own children either way.
        {/if}
        {#if fireMode === 'flow'}
          It fires whenever the graph's Trigger reaches it — so wiring it inline ahead of its own target resets on every
          hit. Give it its own MIDI note to put it beside that target instead.
        {:else}
          Its own input fires it, independently of this graph's Trigger — so it can sit in the same graph as the sequence
          it resets without firing on every hit.
        {/if}
      </p>
    {/if}
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
  .hint strong {
    color: var(--ink);
    font-weight: 600;
  }
  /* the "what fires this" block — divided from the target picker above */
  .firesection {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-faint);
  }
  .note-row {
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
  .warn {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--live-bright);
    line-height: var(--leading-normal);
  }
</style>
