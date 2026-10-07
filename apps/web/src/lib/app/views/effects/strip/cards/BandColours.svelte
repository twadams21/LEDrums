<script lang="ts">
  /* A Splice's (or Slice's) band colours, in band order, under COLOUR — the Generator standard keeps
     all colour in one section (Tim, 2026-10-07: "is there a reason that splice has maintained its
     colours at the start of the card, rather than in the order that rule 2 would enforce?"). One
     colour box per band, numbered as the band list numbers them; a band may have no colour (its
     Generator then plays untinted), so a box can be cleared. A band turned off is dimmed. Every
     pick is one undo step. */
  import type { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import ColorField from '../../../../../ui/ColorField.svelte';
  import GestureScope from './GestureScope.svelte';
  import { slotsAtCount, spliceCountOf } from './splice-face';

  let { api, effect, disabled = false }: { api: EffectsAuthoringApi; effect: effectChain.Effect; disabled?: boolean } = $props();

  type SpliceSlot = effectChain.SpliceSlot;
  const noun = $derived(effect.generator.kind === 'slice' ? 'Slice' : 'Splice');
  const slots = $derived(slotsAtCount(effect.generator.slots ?? [], spliceCountOf(effect.generator.params)));

  function setColour(index: number, colour: string | null): void {
    api.setSpliceSlots(
      effect.id,
      slots.map((s, i) => {
        if (i !== index) return s;
        const next: SpliceSlot = { ...s };
        if (colour) next.color = colour;
        else delete next.color;
        return next;
      }),
    );
  }
</script>

<ol class="bands" aria-label={`${noun} colours`}>
  {#each slots as slot, i (i)}
    <li class:off={slot.muted}>
      <span class="idx">{i + 1}</span>
      <GestureScope onGestureStart={() => api.beginGesture()} onGestureEnd={() => api.endGesture()}>
        <ColorField
          value={slot.color ?? null}
          {disabled}
          ariaLabel={`${noun} ${i + 1} colour`}
          onChange={(v) => setColour(i, v)}
          class="band"
        />
      </GestureScope>
    </li>
  {/each}
</ol>

<style>
  .bands {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  li.off {
    opacity: 0.4;
  }
  .idx {
    min-width: 10px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    text-align: right;
  }
  /* The box alone: the hex would make a row of bands too wide for the column. */
  li :global(.band .hex) {
    display: none;
  }
</style>
