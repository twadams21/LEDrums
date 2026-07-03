<script lang="ts">
  /* Bottom dock — the Layers / Buses overview. One card per voice bus: name,
     polyphony rule (mono/poly), live meter, and the voices currently sounding on
     it. Clicking a card selects the bus into the right-dock Inspector (crossfade /
     blend live there). Ported from the prototype's voice lanes, compacted to a
     horizontal strip for the dock. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { Polyphony } from '../../trigger-lab/sim';
  import type { DockVoice } from '../../trigger-lab/dock-voices';
  import { groupVoicesByBus } from '../../trigger-lab/dock-smoothing';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import { busIcon } from '../views/trigger-node-meta';
  import Zap from '@lucide/svelte/icons/zap';
  import Repeat from '@lucide/svelte/icons/repeat';
  import Hand from '@lucide/svelte/icons/hand';
  import Square from '@lucide/svelte/icons/square';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const POLY_OPTS = [
    { value: 'mono', label: 'mono' },
    { value: 'poly', label: 'poly' },
  ];

  // Display-smoothed voices (item H — the 2 Hz server stats glide instead of stepping),
  // grouped by bus in ONE pass instead of a per-bus filter() every render.
  const voicesByBus = $derived(groupVoicesByBus(store.dockVoicesDisplay));
  const NO_VOICES: DockVoice[] = [];

  function voiceStyle(v: DockVoice): string {
    const L = v.level;
    const hue = v.hue;
    const bg = `oklch(${(0.26 + 0.52 * L).toFixed(3)} ${(0.04 + 0.16 * L).toFixed(3)} ${hue} / ${(0.2 + 0.8 * L).toFixed(3)})`;
    return `background:${bg}; border-color: oklch(0.75 0.15 ${hue} / ${(0.35 + 0.6 * L).toFixed(2)});`;
  }
</script>

<div class="layers">
  {#each store.buses as bus (bus.id)}
    {@const voices = voicesByBus.get(bus.id) ?? NO_VOICES}
    {@const selected = shell.isSelected({ kind: 'bus', busId: bus.id })}
    {@const I = busIcon[bus.id]}
    <article class="bus" class:selected>
      <header class="head">
        <button class="busname" onclick={() => shell.select({ kind: 'bus', busId: bus.id })} title="Inspect this bus">
          {#if I}<I size={14} aria-hidden="true" />{/if}
          {bus.name}
        </button>
        <SegmentedControl
          value={bus.polyphony}
          options={POLY_OPTS}
          onChange={(v) => store.setPolyphony(bus.id, v as Polyphony)}
          ariaLabel="{bus.name} polyphony"
        />
        <IconButton icon={Square} label="Release {bus.name}" size={13} onclick={() => store.stopBus(bus.id)} />
      </header>

      <div class="meter" aria-hidden="true"><span style="transform:scaleX({store.busLevelsDisplay[bus.id] ?? 0})"></span></div>

      <div class="voices" class:empty={voices.length === 0}>
        {#if voices.length === 0}
          <span class="silent">— silent —</span>
        {:else}
          {#each voices as v (v.id)}
            <span class="voice" class:releasing={v.releasing} style={voiceStyle(v)} title={v.via}>
              {#if v.mode === 'oneshot'}<Zap size={11} aria-hidden="true" />{:else if v.mode === 'loop'}<Repeat size={11} aria-hidden="true" />{:else}<Hand size={11} aria-hidden="true" />{/if}
              {store.sim.effectName(v.effectId)}
            </span>
          {/each}
        {/if}
      </div>
    </article>
  {/each}
</div>

<style>
  .layers {
    display: flex;
    gap: var(--space-3);
    height: 100%;
    min-height: 0;
    padding: var(--space-3);
    overflow-x: auto;
  }
  .bus {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: var(--space-2);
    flex: 1 1 0;
    min-width: 220px;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    transition: border-color 140ms ease;
  }
  .bus.selected {
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .busname {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    justify-content: flex-start;
    padding: 2px var(--space-1);
    background: transparent;
    border: none;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ink);
    text-align: left;
  }
  .busname :global(svg) {
    color: var(--accent);
    flex: none;
  }
  .busname:hover {
    color: var(--accent);
  }
  .meter {
    height: 5px;
    background: var(--surface-inset);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    width: 100%;
    transform-origin: left;
    background: linear-gradient(90deg, var(--accent-dim), var(--accent));
    /* no CSS transition: the store's display smoothing already glides the value every
       frame (item H) — a transition on top would just add lag */
  }
  .voices {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 5px;
    min-height: 0;
    overflow: auto;
  }
  .voices.empty {
    align-items: center;
  }
  .silent {
    color: var(--text-disabled);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
  }
  .voice {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    font-size: var(--text-2xs);
    color: var(--ink);
    white-space: nowrap;
  }
  .voice.releasing {
    opacity: 0.85;
  }
  .voice :global(svg) {
    flex: none;
    opacity: 0.85;
  }
</style>
