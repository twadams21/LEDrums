<script lang="ts">
  /* Audio modulation source (GH #214): which live feature band this node reads, with the same
     live-value face the CC / OSC sources show. The band persists on the node; capture itself is a
     local, per-machine affordance that lives in Settings › Input, so when nothing is captured the
     inspector says so instead of showing a meter that will never move. */
  import { voice } from '@ledrums/core';
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode } from '../../../trigger-lab/sim';
  import Field from '../../../ui/Field.svelte';
  import Select from '../../../ui/Select.svelte';
  import NodeSignalPreview from '../../views/NodeSignalPreview.svelte';
  import { AUDIO_BAND_OPTIONS } from '../../../audio/band-labels';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();
  const band = $derived(store.audioNodeBand(node));
  const capturing = $derived(store.audioStatus === 'running');
</script>

{#if node.kind === 'audio'}
  <div class="kindbody">
    <figure class="preview">
      <NodeSignalPreview kind="audio" ccValue={() => store.audioNodeLiveValue(node)} w={188} h={30} />
      <figcaption>Live value</figcaption>
    </figure>
    <Field label="Band" info="Level is broadband loudness; Bass 20–250 Hz, Mids 250–2 kHz, Highs 2–12 kHz.">
      <Select
        value={band}
        options={[...AUDIO_BAND_OPTIONS]}
        onChange={(v) => store.setAudioNodeBand(node, v as voice.AudioBand)}
        ariaLabel="Audio band"
      />
    </Field>
    {#if !capturing}
      <p class="hint off" role="status">Audio input is off — enable it in Settings › Input. Until then this source reads 0.</p>
    {/if}
    <p class="hint">
      This band drives every parameter it's wired to, live on all voices. Set wire depth,
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
  .hint.off {
    color: var(--text);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
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
