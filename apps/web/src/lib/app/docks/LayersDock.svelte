<script lang="ts">
  /* Layers — the full-height right-column panel (wave-3 shell): the voices sounding right now.
     Every Effect voice plays on the engine's one internal bus (an Effect's own retrigger setting
     is its polyphony), so this is one card: a live meter, a Release-all button, and a chip per
     sounding voice named after the Effect that spawned it. The source is the server's streamed
     voices when linked, the offline Sim's engine otherwise (see `store.dockVoicesDisplay`). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { DockVoice } from '../../trigger-lab/dock-voices';
  import IconButton from '../../ui/IconButton.svelte';
  import { gamutSafeOklch } from '../../ui/oklch-gamut';
  import Zap from '@lucide/svelte/icons/zap';
  import Repeat from '@lucide/svelte/icons/repeat';
  import Hand from '@lucide/svelte/icons/hand';
  import Square from '@lucide/svelte/icons/square';
  import Sparkles from '@lucide/svelte/icons/sparkles';

  let { store }: { store: TriggerLab } = $props();

  const voices = $derived(store.dockVoicesDisplay);
  /** The summed display level of every bus, capped at 1 (the Effect engine runs one bus). */
  const level = $derived(Math.min(1, Object.values(store.busLevelsDisplay).reduce((sum, l) => sum + l, 0)));

  /** The Effect a voice belongs to: the engine labels Effect-path voices `Effect: <name>`. */
  function voiceName(v: DockVoice): string {
    return v.via.startsWith('Effect: ') ? v.via.slice('Effect: '.length) : v.via;
  }

  function voiceStyle(v: DockVoice): string {
    const L = v.level;
    const hue = v.hue;
    // Voice hue comes from the show, so these land anywhere on the wheel — including
    // well outside sRGB at the top of the ramp. gamutSafeOklch clamps chroma to what
    // the display can actually show, so WebKit and Chromium don't gamut-map it two
    // different ways. Hue survives; only saturation gives way.
    const bg = gamutSafeOklch(0.26 + 0.52 * L, 0.04 + 0.16 * L, hue, 0.2 + 0.8 * L);
    const border = gamutSafeOklch(0.75, 0.15, hue, 0.35 + 0.6 * L);
    return `background:${bg}; border-color: ${border};`;
  }
</script>

<div class="layers">
  <article class="bus">
    <header class="head">
      <span class="busname"><Sparkles size={14} aria-hidden="true" />Effects</span>
      <span class="count">{voices.length} {voices.length === 1 ? 'voice' : 'voices'}</span>
      <IconButton icon={Square} label="Release all voices" size={13} onclick={() => store.panic()} />
    </header>

    <div class="meter" aria-hidden="true"><span style="transform:scaleX({level})"></span></div>

    <div class="voices" class:empty={voices.length === 0}>
      {#if voices.length === 0}
        <span class="silent">no voices</span>
      {:else}
        {#each voices as v (v.id)}
          <span class="voice" class:releasing={v.releasing} style={voiceStyle(v)} title={v.via}>
            {#if v.mode === 'oneshot'}<Zap size={11} aria-hidden="true" />{:else if v.mode === 'loop'}<Repeat size={11} aria-hidden="true" />{:else}<Hand size={11} aria-hidden="true" />{/if}
            {voiceName(v)}
          </span>
        {/each}
      {/if}
    </div>
  </article>
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
    min-width: 0;
    padding: 2px var(--space-1);
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ink);
  }
  .busname :global(svg) {
    color: var(--accent);
    flex: none;
  }
  .count {
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
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
</style>
