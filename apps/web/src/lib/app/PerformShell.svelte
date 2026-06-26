<script lang="ts">
  /* Perform shell — live, minimal chrome. Songs rail (left) · live bar (mode ·
     transport · status · output) · section-recall strip · big 3D|2D visualizer
     split · large trigger pads. Same engine store as Author, different surface. */
  import type { TriggerLab } from '../trigger-lab/store.svelte';
  import type { ShellStore } from './shell-store.svelte';
  import type { Pad } from '../trigger-lab/fixtures';
  import ModeSwitch from './chrome/ModeSwitch.svelte';
  import Transport from './chrome/Transport.svelte';
  import OutputPill from './chrome/OutputPill.svelte';
  import SongRail from './chrome/SongRail.svelte';
  import Visualizer from './docks/Visualizer.svelte';
  import StatusBar from '../trigger-lab/StatusBar.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import Splitter from '../ui/Splitter.svelte';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  // one big pad per drum → fires that drum's first authored zone (preview/live).
  const drumPads = $derived(
    store.drums.map((d) => ({ drum: d, pad: store.pads.find((p) => p.drumId === d.id) ?? null })),
  );

  function firePad(pad: Pad | null): void {
    if (pad) store.hit(pad);
  }

  // Resizable layout (persisted live via store.paneSizes; keys namespaced "perform").
  const GAP = 12; // ≈ var(--space-3), for the 50/50 default of the viz split
  const PRAIL = { key: 'performRailW', def: 184, min: 140, max: 340 };
  const prailW = $derived(store.paneSizes[PRAIL.key] ?? PRAIL.def);
  const setPane = (key: string, v: number): void => {
    store.paneSizes = { ...store.paneSizes, [key]: v };
  };

  // 3D|2D split: a px left column over a measured container; defaults to 50/50
  // (rendered as `1fr 1fr` until measured, so there is no first-paint flash).
  const PVIZ_KEY = 'performPvizLeft';
  const PVIZ_MIN = 220;
  let pvizW = $state(0);
  const pvizLeft = $derived(store.paneSizes[PVIZ_KEY] ?? (pvizW > 0 ? (pvizW - GAP) / 2 : null));
  const pvizCols = $derived(pvizLeft == null ? '1fr 1fr' : `${pvizLeft}px minmax(0, 1fr)`);
  const pvizMax = $derived(pvizW > 0 ? Math.max(PVIZ_MIN, pvizW - GAP - PVIZ_MIN) : PVIZ_MIN);
</script>

<div class="perform" style="--prail-w:{prailW}px;">
  <aside class="prail">
    <SongRail {store} />
  </aside>

  <Splitter
    orientation="vertical"
    size={prailW}
    min={PRAIL.min}
    max={PRAIL.max}
    onResize={(v) => setPane(PRAIL.key, v)}
    label="Resize songs rail"
    style="top:var(--pad); bottom:var(--pad); left:calc(var(--pad) + var(--prail-w) + var(--gap) / 2); transform:translateX(-50%);"
  />

  <div class="pbar">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <span class="word">LEDrums</span>
    </div>
    <ModeSwitch {shell} />
    <div class="tslot"><Transport {store} compact /></div>
    <div class="right">
      <StatusBar {store} />
      <OutputPill {store} />
    </div>
  </div>

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
  .perform {
    --pad: var(--space-3);
    --gap: var(--space-3);
    position: relative;
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-columns: var(--prail-w, 184px) minmax(0, 1fr);
    grid-template-rows: 54px auto minmax(0, 1fr) 176px;
    grid-template-areas:
      'prail pbar'
      'prail precall'
      'prail pviz'
      'prail ppads';
    gap: var(--gap);
    padding: var(--pad);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .prail {
    grid-area: prail;
    min-height: 0;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    display: flex;
  }
  .prail :global(.songrail) {
    flex: 1;
    min-height: 0;
  }
  .pbar {
    grid-area: pbar;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0 var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }
  .mark {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-2);
    background: conic-gradient(
      from 210deg,
      var(--role-input),
      var(--role-content),
      var(--role-effect),
      var(--role-layer),
      var(--role-output),
      var(--role-input)
    );
    flex: none;
  }
  .word {
    font-size: var(--text-md);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    color: var(--ink);
  }
  .tslot {
    flex: 1 1 auto;
    display: flex;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
  }
  .right {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex: none;
  }
  .precall {
    grid-area: precall;
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
    grid-area: pviz;
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
    grid-area: ppads;
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
