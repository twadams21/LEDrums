<script lang="ts">
  /* The per-Effect header above its chain (spec "Device strip"): a reorder grip, the power
     (bypass) toggle, a live fire flash + audition, the name (double-click to rename, the house
     rename gesture), then blend, opacity and retrigger, and a menu (also on right-click) with
     Rename, Save to file…, Load file into Effect…, Duplicate and Delete.

     A click on the header selects the Effect. The grip drags the row (DeviceStrip owns the
     drop) and nudges it with ↑ / ↓ from the keyboard, so reordering never needs a mouse. */
  import type { effectChain } from '@ledrums/core';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Power from '@lucide/svelte/icons/power';
  import Play from '@lucide/svelte/icons/play';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Save from '@lucide/svelte/icons/save';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Copy from '@lucide/svelte/icons/copy';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import CommitInput from '../../../../ui/CommitInput.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../../../ui/ContextMenu.svelte';
  import FaceParamControl from '../../../../ui/FaceParamControl.svelte';
  import Select from '../../../../ui/Select.svelte';
  import Tooltip from '../../../../ui/Tooltip.svelte';
  import { pushToast } from '../../../../ui/toast.svelte';
  import { mappable } from '../../../map-mode/mappable.svelte';
  import { GENERATOR_ICON } from './generator-icons';
  import { BLEND_OPTIONS, RETRIGGER_OPTIONS, effectDisplayName, percent } from './strip-model';

  type Props = {
    api: EffectsAuthoringApi;
    effect: effectChain.Effect;
    /** Position in the cell's stack and the stack size (for the grip's label). */
    index: number;
    count: number;
    selected?: boolean;
    onGripDragStart?: (event: DragEvent) => void;
    onGripDragEnd?: () => void;
    onNudge?: (delta: -1 | 1) => void;
  };

  let { api, effect, index, count, selected = false, onGripDragStart, onGripDragEnd, onNudge }: Props = $props();

  const FLASH_MS = 360;
  let renaming = $state(false);
  const name = $derived(effectDisplayName(effect));
  const disabled = $derived(!api.canEdit);
  const fireAt = $derived(api.effectFireAt(effect.id));
  const GenIcon = $derived(GENERATOR_ICON[effect.generator.kind]);

  async function loadFile(): Promise<void> {
    const result = await api.loadFileIntoEffect(effect.id);
    if (!result.ok) pushToast(result.reason, { tone: 'error' });
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Rename', icon: Pencil, disabled, onSelect: () => (renaming = true) },
    { label: 'Save to file…', icon: Save, onSelect: () => void api.saveEffectToFile(effect.id) },
    { label: 'Load file into Effect…', icon: FolderOpen, disabled, onSelect: () => void loadFile() },
    { label: 'Duplicate', icon: Copy, disabled, onSelect: () => api.duplicateEffect(effect.id) },
    { label: 'Delete', icon: Trash2, danger: true, disabled, onSelect: () => api.removeEffect(effect.id) },
  ]);

  function onGripKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onNudge?.(event.key === 'ArrowUp' ? -1 : 1);
  }
</script>

<ContextMenu {actions}>
  <!-- The header click is a convenience: every control inside is keyboard reachable, and the
       name button (inside the header) selects. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="head" class:selected class:bypassed={effect.bypass} onclick={() => api.selectDevice({ kind: 'effect', effectId: effect.id })}>
    <Tooltip text="Drag to reorder · ↑ ↓ to move">
      <button
        type="button"
        class="grip"
        draggable={!disabled && count > 1}
        data-keyboard-owner="roving"
        aria-label={`${name}, ${index + 1} of ${count}. Arrow up or down to move.`}
        disabled={disabled || count < 2}
        ondragstart={onGripDragStart}
        ondragend={onGripDragEnd}
        onkeydown={onGripKey}
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
    </Tooltip>

    <Tooltip text={effect.bypass ? 'Enable Effect' : 'Bypass Effect'}>
      <button
        type="button"
        class="power"
        class:on={!effect.bypass}
        aria-pressed={!effect.bypass}
        aria-label={`${name} on`}
        {disabled}
        {@attach mappable({ target: { kind: 'bypass', effectId: effect.id }, kind: 'toggle', label: `${name} · On` })}
        onclick={(e) => {
          e.stopPropagation();
          api.setEffectBypass(effect.id, !effect.bypass);
        }}
      >
        <Power size={14} aria-hidden="true" />
      </button>
    </Tooltip>

    <Tooltip text="Audition">
      <button
        type="button"
        class="fire"
        aria-label={`Audition ${name}`}
        {@attach mappable({ target: { kind: 'fireEffect', effectId: effect.id }, kind: 'button', label: `${name} · Fire` })}
        onclick={(e) => {
          e.stopPropagation();
          api.fireEffect(effect.id);
        }}
      >
        {#key fireAt}
          <!-- Keyed on the fire time: each fire remounts the flash, so it restarts from full.
               Only a FRESH fire flashes — reopening the strip never replays an old one. -->
          <span class="flash" class:live={fireAt > 0 && performance.now() - fireAt < FLASH_MS} aria-hidden="true"></span>
        {/key}
        <Play size={12} aria-hidden="true" />
      </button>
    </Tooltip>

    <span class="gen" aria-hidden="true"><GenIcon size={14} /></span>

    {#if renaming}
      <span class="rename">
        <CommitInput
          value={effect.name || name}
          ariaLabel="Effect name"
          onCommit={(v) => {
            api.renameEffect(effect.id, v);
            renaming = false;
          }}
          onCancel={() => (renaming = false)}
        />
      </span>
    {:else}
      <button
        type="button"
        class="name"
        title="Double-click to rename"
        ondblclick={() => {
          if (!disabled) renaming = true;
        }}
      >{name}</button>
    {/if}

    <span class="controls">
      <span class="ctl">
        <span class="k">Blend</span>
        <Select value={effect.blend} options={BLEND_OPTIONS} ariaLabel="Blend mode" {disabled}
          class="blend" onChange={(v) => api.setEffectBlend(effect.id, v as effectChain.Effect['blend'])} />
      </span>
      <span class="ctl" {@attach mappable({ target: { kind: 'opacity', effectId: effect.id }, kind: 'continuous', label: `${name} · Opacity` })}>
        <span class="k">Opacity</span>
        <FaceParamControl kind="number" value={effect.opacity} display={percent(effect.opacity)} min={0} max={1} step={0.01}
          ariaLabel="Opacity" {disabled} onGestureStart={() => api.beginGesture()} onGestureEnd={() => api.endGesture()}
          onChange={(v) => api.setEffectOpacity(effect.id, Number(v))} />
      </span>
      <span class="ctl">
        <span class="k">Retrigger</span>
        <Select value={effect.retrigger} options={RETRIGGER_OPTIONS} ariaLabel="Retrigger" {disabled}
          onChange={(v) => api.setRetrigger(effect.id, v as effectChain.Retrigger)} />
      </span>
    </span>

    <Tooltip text="Effect actions">
      <ContextMenu mode="dropdown" label={`Actions for ${name}`} {actions}>
        <Ellipsis size={16} aria-hidden="true" />
      </ContextMenu>
    </Tooltip>
  </div>
</ContextMenu>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: 40px;
    min-width: 0;
    padding: 0 var(--space-2) 0 var(--space-1);
    background: var(--surface);
    border-bottom: 1px solid var(--border-faint);
  }
  .head.selected {
    background: color-mix(in oklch, var(--accent) 7%, var(--surface));
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .grip,
  .power,
  .fire {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    padding: 0;
    color: var(--text-faint);
    background: transparent;
    border: 0;
    border-radius: var(--radius-1);
    cursor: pointer;
  }
  .grip {
    width: 20px;
    cursor: grab;
  }
  .grip:disabled {
    cursor: default;
    opacity: 0.35;
  }
  .grip:hover:not(:disabled),
  .power:hover:not(:disabled),
  .fire:hover {
    color: var(--ink);
    background: var(--surface-3);
  }
  .power.on {
    color: var(--accent-bright);
  }
  .power:disabled {
    cursor: default;
  }
  .flash {
    position: absolute;
    inset: 4px;
    border-radius: var(--radius-1);
    background: var(--role-content);
    opacity: 0;
  }
  .flash.live {
    animation: fire-flash 360ms ease-out forwards;
  }
  @keyframes fire-flash {
    from {
      opacity: 0.55;
    }
    to {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .flash.live {
      animation-duration: 1ms;
    }
  }
  .fire :global(svg) {
    position: relative;
    translate: 1px 0; /* optical centre of the play triangle */
  }
  .gen {
    display: inline-grid;
    place-items: center;
    flex: none;
    color: var(--role-content);
  }
  .name {
    min-width: 4rem;
    max-width: 16rem;
    height: 28px;
    padding: 0 var(--space-1);
    overflow: hidden;
    color: var(--ink);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
    text-overflow: ellipsis;
    background: transparent;
    border: 0;
    border-radius: var(--radius-1);
    cursor: default;
  }
  .bypassed .name,
  .bypassed .gen {
    color: var(--text-faint);
  }
  .rename {
    width: 14rem;
    flex: none;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
    min-width: 0;
  }
  .ctl {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1_5);
    flex: none;
  }
  .k {
    color: var(--text-faint);
    font-size: var(--text-2xs);
  }
  .head :global(.blend) {
    min-width: 7rem;
  }
</style>
