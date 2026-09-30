<script lang="ts">
  /* One Effect as a left-to-right device chain (spec story 13): Trigger · Generator ·
     Modifiers… (+) · Controls… (+) · Target. The chain scrolls horizontally inside its row, so
     long chains keep every card at its readable fixed width. A bypassed Effect's chain dims. */
  import type { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import GeneratorCard from './cards/GeneratorCard.svelte';
  import ControlCard from './cards/ControlCard.svelte';
  import TriggerCard from './TriggerCard.svelte';
  import TargetCard from './TargetCard.svelte';
  import ModifierRun from './ModifierRun.svelte';
  import AddDeviceSlot from './AddDeviceSlot.svelte';

  let { api, effect }: { api: EffectsAuthoringApi; effect: effectChain.Effect } = $props();
</script>

<div class="chain" class:bypassed={effect.bypass} role="group" aria-label="Device chain">
  <TriggerCard {api} {effect} />
  <span class="wire" aria-hidden="true"></span>
  <GeneratorCard {api} {effect} />
  <span class="wire" aria-hidden="true"></span>
  <ModifierRun {api} owner={effect.id} modifiers={effect.modifiers} />
  {#if effect.controls.length > 0}<span class="sep" aria-hidden="true"></span>{/if}
  {#each effect.controls as control (control.uid)}
    <ControlCard {api} {effect} {control} />
  {/each}
  <AddDeviceSlot {api} kind="control" owner={effect.id} />
  <span class="wire" aria-hidden="true"></span>
  <TargetCard {api} {effect} />
</div>

<style>
  .chain {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-2);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    overscroll-behavior-x: contain;
  }
  .chain.bypassed {
    opacity: 0.55;
  }
  /* The signal path between stages: a short rule at title-bar height. */
  .wire {
    align-self: flex-start;
    width: 8px;
    margin: 16px calc(-1 * var(--space-1)) 0;
    height: 1px;
    flex: none;
    background: var(--border-strong);
  }
  .sep {
    width: 1px;
    flex: none;
    margin: var(--space-3) var(--space-1);
    background: var(--border-faint);
  }
</style>
