<script lang="ts">
  /* Envelope SOURCE node editor (doc 10, S34) — edits the node's single ADSR shape via the
     reusable EnvelopeEditorView (the same curve editor the per-param modal uses). A modulation
     source has no per-param amount/range of its own: depth + range are per-mapping, edited on
     the TARGET node's Parameters section. So this inspector is just the shape. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, AdsrShape } from '../../../trigger-lab/sim';
  import EnvelopeEditorView from '../../../trigger-lab/EnvelopeEditorView.svelte';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const adsr = $derived(store.envelopeNodeAdsr(node));
  function onShape(next: AdsrShape): void {
    store.setEnvelopeNodeAdsr(node, next);
  }
</script>

{#if node.kind === 'envelope'}
  <div class="kindbody">
    <EnvelopeEditorView {adsr} {onShape} label="Envelope source" />
    <p class="hint">
      This shape drives every parameter it's wired to — each hit runs its own instance over that
      voice's life. Set a wire's depth, invert and range on the target node's Parameters section.
    </p>
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
    text-wrap: pretty;
  }
</style>
