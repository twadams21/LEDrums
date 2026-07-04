<script lang="ts">
  /* Buses / Layers — the full-height right-column panel (wave-3 shell). One card per
     voice bus, stacked vertically: name, polyphony rule (mono/poly), live meter, and
     the voices currently sounding on it. Selecting a bus expands its settings
     (crossfade + behaviour note) inline in the card — there is no separate bus
     inspector panel. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { Polyphony } from '../../trigger-lab/sim';
  import type { DockVoice } from '../../trigger-lab/dock-voices';
  import { groupVoicesByBus } from '../../trigger-lab/dock-smoothing';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Slider from '../../ui/Slider.svelte';
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

  /** Toggle a bus's inline settings: select it, or collapse when already open. */
  function toggleBus(busId: string): void {
    if (shell.isSelected({ kind: 'bus', busId })) shell.clearSelection();
    else shell.select({ kind: 'bus', busId });
  }
</script>

<div class="layers">
  {#each store.buses as bus (bus.id)}
    {@const voices = voicesByBus.get(bus.id) ?? NO_VOICES}
    {@const selected = shell.isSelected({ kind: 'bus', busId: bus.id })}
    {@const I = busIcon[bus.id]}
    <article class="bus" class:selected>
      <header class="head">
        <button class="busname" onclick={() => toggleBus(bus.id)} title="Bus settings" aria-expanded={selected}>
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
          <span class="silent">no voices</span>
        {:else}
          {#each voices as v (v.id)}
            <span class="voice" class:releasing={v.releasing} style={voiceStyle(v)} title={v.via}>
              {#if v.mode === 'oneshot'}<Zap size={11} aria-hidden="true" />{:else if v.mode === 'loop'}<Repeat size={11} aria-hidden="true" />{:else}<Hand size={11} aria-hidden="true" />{/if}
              {store.sim.effectName(v.effectId)}
            </span>
          {/each}
        {/if}
      </div>

      {#if selected}
        <div class="more">
          <label class="xfade">
            <span class="k">Crossfade</span>
            <span class="sld">
              <Slider
                min={60}
                max={2000}
                step={20}
                value={bus.crossfadeMs}
                onChange={(v) => store.setCrossfade(bus.id, v)}
                format={(v) => `${Math.round(v)}ms`}
              />
            </span>
          </label>
          <p class="foot">
            {bus.polyphony === 'mono'
              ? 'Mono — a new voice replaces the old with a crossfade.'
              : 'Poly — voices stack and fade out on their own.'}
          </p>
        </div>
      {/if}
    </article>
  {/each}
</div>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 100%;
    min-height: 0;
    padding: var(--space-2);
    overflow-y: auto;
  }
  .bus {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: none;
    padding: var(--space-2) var(--space-3) var(--space-3);
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
    min-height: 22px;
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
  .more {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-faint);
  }
  .xfade {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .k {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .sld {
    flex: 1;
    min-width: 0;
  }
  .foot {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    line-height: var(--leading-snug);
  }
</style>
