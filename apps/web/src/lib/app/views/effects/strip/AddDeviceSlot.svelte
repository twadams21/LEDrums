<script lang="ts" module>
  import type { effectChain } from '@ledrums/core';

  /** Control kinds in picker order, with their labels. */
  export const CONTROL_KINDS: { kind: effectChain.ControlKind; label: string }[] = [
    { kind: 'envelope', label: 'Envelope' },
    { kind: 'lfo', label: 'LFO' },
    { kind: 'velocity', label: 'Velocity' },
    { kind: 'random', label: 'Random' },
    { kind: 'cc', label: 'MIDI CC' },
    { kind: 'note', label: 'MIDI note' },
    { kind: 'osc', label: 'OSC' },
    { kind: 'audio', label: 'Audio' },
  ];
</script>

<script lang="ts">
  /* The "+" slot at the end of a run of devices (Ableton's drop area): "+ Modifier" opens the
     modifier palette grouped by category (core `listModifiersByCategory`, so a newly registered
     modifier appears with no edit here); "+ Control" lists the control kinds. A slot is a narrow
     full-height column so it reads as "the next device goes here". */
  import { Popover } from 'bits-ui';
  import { listModifiersByCategory } from '@ledrums/core';
  import Plus from '@lucide/svelte/icons/plus';
  import { MASTER_CELL, type EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import Tooltip from '../../../../ui/Tooltip.svelte';

  type Props = {
    api: EffectsAuthoringApi;
    kind: 'modifier' | 'control';
    /** The Effect id (or the Master chain for modifiers). */
    owner: string | typeof MASTER_CELL;
  };

  let { api, kind, owner }: Props = $props();

  const groups = listModifiersByCategory();
  let open = $state(false);
  const label = $derived(kind === 'modifier' ? 'Modifier' : 'Control');
  const disabled = $derived(!api.canEdit || (kind === 'control' && owner === MASTER_CELL));

  function add(id: string): void {
    if (kind === 'modifier') api.addModifier(owner, id);
    else if (owner !== MASTER_CELL) api.addControl(owner, id as effectChain.ControlKind);
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Tooltip text={`Add ${label}`} side="top">
    <Popover.Trigger class={['add-slot', `add-${kind}`]} aria-label={`Add ${label}`} {disabled}>
      <Plus size={14} aria-hidden="true" />
      <span class="add-label">{label}</span>
    </Popover.Trigger>
  </Tooltip>
  <Popover.Portal>
    <Popover.Content class="lab-add-device" data-keyboard-owner="popover" side="top" align="start" sideOffset={6}>
      {#if kind === 'modifier'}
        {#each groups as group (group.category)}
          <div class="lab-add-group" role="group" aria-label={group.label}>
            <span class="lab-add-head">{group.label}</span>
            {#each group.modifiers as mod (mod.id)}
              <button type="button" class="lab-add-item" onclick={() => add(mod.id)}>{mod.name}</button>
            {/each}
          </div>
        {/each}
      {:else}
        <div class="lab-add-group" role="group" aria-label="Controls">
          {#each CONTROL_KINDS as c (c.kind)}
            <button type="button" class="lab-add-item" onclick={() => add(c.kind)}>{c.label}</button>
          {/each}
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.add-slot) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    flex: none;
    width: 40px;
    height: var(--device-h, 216px);
    padding: 0;
    color: var(--text-faint);
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: var(--radius-card);
    cursor: pointer;
  }
  :global(.add-slot.add-modifier:hover:not(:disabled)) {
    color: var(--role-effect);
    border-color: color-mix(in oklch, var(--role-effect) 60%, var(--border));
  }
  :global(.add-slot.add-control:hover:not(:disabled)) {
    color: var(--role-mod);
    border-color: color-mix(in oklch, var(--role-mod) 60%, var(--border));
  }
  :global(.add-slot:disabled) {
    cursor: default;
    opacity: 0.45;
  }
  :global(.add-slot:focus-visible) {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
  :global(.add-slot .add-label) {
    writing-mode: vertical-rl;
    rotate: 180deg;
    font-size: var(--text-2xs);
    font-weight: 600;
  }
  :global(.lab-add-device) {
    z-index: var(--z-tooltip);
    display: flex;
    gap: var(--space-2);
    max-width: min(640px, 90vw);
    padding: var(--space-2);
    background: var(--surface-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-3);
  }
  :global(.lab-add-group) {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 112px;
  }
  :global(.lab-add-head) {
    padding: var(--space-1) var(--space-2);
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  :global(.lab-add-item) {
    padding: var(--space-1) var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: var(--radius-1);
    cursor: pointer;
  }
  :global(.lab-add-item:hover),
  :global(.lab-add-item:focus-visible) {
    color: var(--ink);
    background: var(--surface-2);
  }
  :global(.lab-add-item:focus-visible) {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
</style>
