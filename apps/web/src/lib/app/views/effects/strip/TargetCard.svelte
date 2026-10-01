<script lang="ts">
  /* Target card — WHERE the Effect's light shows (spec stories 53–54): the whole kit, the drum
     that was hit, or chosen drums. For Select, each drum is a toggle chip in its kit colour; a
     selected drum can be narrowed to single hoops when the host reports hoop counts
     (`drumHoopCount`, see strip-model) — otherwise the whole drum is the unit. */
  import { effectChain } from '@ledrums/core';
  import Crosshair from '@lucide/svelte/icons/crosshair';
  import type { EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import SegmentedControl from '../../../../ui/SegmentedControl.svelte';
  import DeviceCard from './DeviceCard.svelte';
  import {
    TARGET_KIND_OPTIONS,
    drumHoopCount,
    targetForKind,
    targetHoopOn,
    toggleTargetDrum,
    toggleTargetHoop,
    type TargetKind,
  } from './strip-model';

  let { api, effect }: { api: EffectsAuthoringApi; effect: effectChain.Effect } = $props();

  const target = $derived(effect.target);
  const disabled = $derived(!api.canEdit);
  const drums = $derived(api.gridRows.filter((r) => r.id !== effectChain.KIT_ROW));
  const selected = $derived(target.kind === 'select' ? target : null);

  const summary = $derived.by(() => {
    if (target.kind === 'kit') return 'Every drum in the kit.';
    if (target.kind === 'hitDrum') return 'The drum whose hit fired it.';
    if (target.drums.length === 0) return 'Nothing selected — the Effect is dark.';
    return `${target.drums.length} of ${drums.length} drums`;
  });

  function setKind(kind: string): void {
    api.setTarget(effect.id, targetForKind(kind as TargetKind, effect, drums));
  }
</script>

<DeviceCard title="Target" tint="var(--role-output)" icon={Crosshair} class="target-card">
  <SegmentedControl value={target.kind} options={TARGET_KIND_OPTIONS} onChange={setKind} ariaLabel="Target kind" {disabled} />
  <p class="summary" class:warn={selected !== null && selected.drums.length === 0}>{summary}</p>

  {#if selected}
    <ul class="drums" aria-label="Target drums">
      {#each drums as drum (drum.id)}
        {@const on = selected.drums.some((d) => d.drumId === drum.id)}
        {@const hoops = on ? drumHoopCount(api, drum.id) : 0}
        <li class="drum" style:--drum={drum.color ?? 'var(--role-output)'}>
          <button
            type="button"
            class="chip"
            class:on
            aria-pressed={on}
            {disabled}
            onclick={() => api.setTarget(effect.id, toggleTargetDrum(selected, drum.id, drums))}
          >
            <span class="dot" aria-hidden="true"></span>
            <span class="label">{drum.label}</span>
          </button>
          {#if hoops > 1}
            <span class="hoops" role="group" aria-label={`${drum.label} hoops`}>
              {#each Array.from({ length: hoops }, (_, i) => i + 1) as hoop (hoop)}
                {@const lit = targetHoopOn(selected, drum.id, hoop)}
                <button
                  type="button"
                  class="hoop"
                  class:lit
                  aria-pressed={lit}
                  aria-label={`${drum.label} hoop ${hoop}`}
                  {disabled}
                  onclick={() => api.setTarget(effect.id, toggleTargetHoop(selected, drum.id, hoop, hoops))}
                >{hoop}</button>
              {/each}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</DeviceCard>

<style>
  .summary {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    text-wrap: pretty;
  }
  .summary.warn {
    color: var(--warn);
  }
  .drums {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .drum {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1_5);
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-1);
    cursor: pointer;
  }
  .chip:hover {
    color: var(--ink);
    border-color: var(--border);
  }
  .chip.on {
    color: var(--ink);
    background: color-mix(in srgb, var(--drum) 14%, var(--surface-inset));
    border-color: color-mix(in srgb, var(--drum) 55%, var(--border));
  }
  .dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: var(--border-strong);
  }
  .on .dot {
    background: var(--drum);
  }
  .label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .hoops {
    display: inline-flex;
    gap: 2px;
    flex: none;
  }
  .hoop {
    width: 20px;
    height: 26px;
    padding: 0;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-1);
    cursor: pointer;
  }
  .hoop:hover {
    color: var(--ink);
  }
  .hoop.lit {
    color: var(--ink);
    border-color: color-mix(in srgb, var(--drum) 55%, var(--border));
  }
  .chip:disabled,
  .hoop:disabled {
    cursor: default;
  }
</style>
