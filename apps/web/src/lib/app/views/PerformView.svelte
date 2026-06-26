<script lang="ts">
  /* Perform view — the focused performance surface inside the unified shell. The
     shell hides the Layers/Buses drawer + right Inspector dock for this view; here
     we render the section-recall strip, an adjustable 3D|2D visualizer split, and a
     grid of big trigger pads. Mined from the old PerformShell — the songs rail and
     the live bar now live in the shell's LeftRail + TopBar, so this view is just the
     center surface. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { Pad } from '../../trigger-lab/fixtures';
  import Visualizer from '../docks/Visualizer.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Splitter from '../../ui/Splitter.svelte';

  let { store, shell: _shell }: { store: TriggerLab; shell: ShellStore } = $props();

  // one big pad per drum → fires that drum's first authored zone (preview/live).
  const drumPads = $derived(
    store.drums.map((d) => ({ drum: d, pad: store.pads.find((p) => p.drumId === d.id) ?? null })),
  );

  function firePad(pad: Pad | null): void {
    if (pad) store.hit(pad);
  }

  // Resizable 3D|2D split (persisted live via store.paneSizes; key namespaced
  // "perform" — no collision with the author panes authorRailW/DockW/BottomH).
  const GAP = 12; // ≈ var(--space-3), for the 50/50 default of the viz split
  const PVIZ_KEY = 'performPvizLeft';
  const PVIZ_MIN = 220;
  let pvizW = $state(0);
  const pvizLeft = $derived(store.paneSizes[PVIZ_KEY] ?? (pvizW > 0 ? (pvizW - GAP) / 2 : null));
  const pvizCols = $derived(pvizLeft == null ? '1fr 1fr' : `${pvizLeft}px minmax(0, 1fr)`);
  const pvizMax = $derived(pvizW > 0 ? Math.max(PVIZ_MIN, pvizW - GAP - PVIZ_MIN) : PVIZ_MIN);
  const setPane = (key: string, v: number): void => {
    store.paneSizes = { ...store.paneSizes, [key]: v };
  };
</script>

<div class="perform-view">
  <div class="precall">
    <Eyebrow>Recall</Eyebrow>
    {#each store.sections as s (s.id)}
      <button class="chip" class:on={store.activeSectionId === s.id} onclick={() => store.setActiveSection(s.id)}>{s.name}</button>
    {/each}
  </div>

  <div class="pviz" bind:clientWidth={pvizW} style="grid-template-columns:{pvizCols}; --pviz-l:{pvizLeft ?? 0}px;">
    <Visualizer {store} mode="3d" showToggle={false} label="3D stage" />
    <Visualizer {store} mode="2d" showToggle={false} label="2D map" />
    {#if pvizLeft != null}
      <Splitter
        orientation="vertical"
        size={pvizLeft}
        min={PVIZ_MIN}
        max={pvizMax}
        onResize={(v) => setPane(PVIZ_KEY, v)}
        label="Resize 3D and 2D split"
        style="top:0; bottom:0; left:calc(var(--pviz-l) + var(--space-3) / 2); transform:translateX(-50%);"
      />
    {/if}
  </div>

  <div class="ppads">
    {#each drumPads as { drum, pad } (drum.id)}
      <button class="bigpad" disabled={!pad} onclick={() => firePad(pad)}>
        <span class="pad-name">{drum.label}</span>
        {#if pad}<span class="pad-zone">{pad.zoneLabel}</span>{/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .perform-view {
    height: 100%;
    min-height: 0;
    min-width: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) 176px;
    gap: var(--space-3);
  }
  .precall {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow-x: auto;
  }
  .chip {
    padding: var(--space-1) var(--space-4);
    font-size: var(--text-sm);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface-inset);
    color: var(--text-muted);
    white-space: nowrap;
    flex: none;
  }
  .chip:hover {
    color: var(--ink);
    border-color: var(--border-strong);
  }
  .chip.on {
    color: var(--ink);
    background: var(--accent-soft);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
  }
  .pviz {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    min-height: 0;
  }
  .pviz :global(.viz) {
    border-radius: var(--radius-card);
  }
  .ppads {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--space-3);
  }
  .bigpad {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    color: var(--ink);
    transition: border-color 120ms ease, background-color 120ms ease, scale 90ms ease;
  }
  .bigpad:hover {
    border-color: var(--border-strong);
    background: var(--surface-3);
  }
  .bigpad:active {
    scale: 0.97;
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .bigpad:disabled {
    opacity: 0.4;
    pointer-events: none;
  }
  .pad-name {
    font-size: var(--text-md);
    font-weight: 700;
  }
  .pad-zone {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .bigpad {
      transition: none;
    }
  }
</style>
