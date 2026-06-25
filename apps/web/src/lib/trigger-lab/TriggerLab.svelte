<script lang="ts">
  /* ===========================================================================
     TRIGGER LAB — throwaway harness to decide three branches before we touch
     packages/core:
       1. voice model  (per-bus mono/poly + crossfade → steal/morph vs stack)
       2. block set    (author trigger trees, fire them, watch resolution)
       3. section blend (cut / morph / live two-deck crossfade)
     Mounted at /?proto=trigger. Delete ./ when the branches are decided.
     =========================================================================== */
  import { TriggerLab } from './store.svelte';
  import type { Voice, Polyphony } from './sim';
  import type { Pad } from './fixtures';
  import NodeCanvas from './NodeCanvas.svelte';
  import EffectGallery from './EffectGallery.svelte';
  import ClipSettings from './ClipSettings.svelte';
  import EnvelopeEditor from './EnvelopeEditor.svelte';
  import EffectCreator from './EffectCreator.svelte';
  import Scene from '../visualizer/Scene.svelte';
  import Pixels2D from '../visualizer/Pixels2D.svelte';
  import Slider from '../ui/Slider.svelte';
  import Select from '../ui/Select.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import StatusBar from './StatusBar.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import Zap from '@lucide/svelte/icons/zap';
  import Repeat from '@lucide/svelte/icons/repeat';
  import Hand from '@lucide/svelte/icons/hand';
  import Disc3 from '@lucide/svelte/icons/disc-3';
  import Activity from '@lucide/svelte/icons/activity';
  import Wand2 from '@lucide/svelte/icons/wand-2';
  import { type Component } from 'svelte';

  const store = new TriggerLab();

  $effect(() => {
    store.start();
    return () => store.stop();
  });

  const padKey = (p: Pad) => `${p.drumId}:${p.zone}`;

  function vlevel(v: Voice): number {
    return v.level * v.deckGain;
  }
  function voiceStyle(v: Voice): string {
    const L = vlevel(v);
    const hue = typeof v.params.hue === 'number' ? v.params.hue : 0;
    const bg = `oklch(${(0.26 + 0.52 * L).toFixed(3)} ${(0.04 + 0.16 * L).toFixed(3)} ${hue} / ${(0.2 + 0.8 * L).toFixed(3)})`;
    const glow = L > 0.55 ? `box-shadow: 0 0 ${Math.round(14 * L)}px oklch(0.8 0.16 ${hue} / ${(0.5 * L).toFixed(2)});` : '';
    return `background:${bg}; border-color: oklch(0.75 0.15 ${hue} / ${(0.35 + 0.6 * L).toFixed(2)}); ${glow}`;
  }

  function onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= store.pads.length) {
      store.selectedPadKey = padKey(store.pads[n - 1]!);
      store.hit(store.pads[n - 1]!);
    }
  }

  function fire(pad: Pad): void {
    store.selectedPadKey = padKey(pad);
    store.hit(pad);
  }

  const bar = $derived(Math.floor(store.beat / store.beatsPerBar) + 1);
  const beatInBar = $derived(Math.floor(store.beat % store.beatsPerBar) + 1);
  // pulse the beat dot on the leading edge of each whole beat (only when running)
  const onBeat = $derived(store.playing && store.beat - Math.floor(store.beat) < 0.18);

  const BPB_OPTS = [3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `${n}/4` }));

  // preview source: store.previewFrame is the server engine's real LED output when
  // connected (paired with store.model = the server's kit), else the local sim
  // composite on the lab kit — frame + model always swap together.
  const previewFrame = $derived(store.previewFrame);

  // kit-preview view mode (3D stage vs flat 2D pixel map — diagnostic counterpart)
  let previewMode = $state<'3d' | '2d'>('3d');
  const PREVIEW_OPTS = [
    { value: '3d', label: '3D' },
    { value: '2d', label: '2D' },
  ];

  // tap-tempo: average the last few tap intervals → BPM (clamped to the slider range)
  let taps = $state<number[]>([]);
  function tap(): void {
    const now = performance.now();
    taps = (taps.length && now - taps[taps.length - 1]! > 2000 ? [now] : [...taps, now]).slice(-8);
    if (taps.length < 2) return;
    let sum = 0;
    for (let i = 1; i < taps.length; i++) sum += taps[i]! - taps[i - 1]!;
    const avg = sum / (taps.length - 1);
    if (avg > 0) store.bpm = Math.max(60, Math.min(200, Math.round(60000 / avg)));
  }

  const POLY_OPTS = [
    { value: 'mono', label: 'mono' },
    { value: 'poly', label: 'poly' },
  ];
  /** Layer/bus icon — matches the node editor's layer router. */
  const busIcon: Record<string, Component> = {
    base: Disc3,
    trigger: Activity,
    effect: Wand2,
  };
</script>

<svelte:window onkeydown={onKey} />

<div class="lab">
  <!-- ── header ─────────────────────────────────────────────────────────── -->
  <header class="top">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <h1>Trigger Lab</h1>
      <span class="tag">throwaway · model probe</span>
    </div>
    <div class="readout">
      <div class="transport">
        <IconButton
          icon={store.playing ? Pause : Play}
          label={store.playing ? 'Stop' : 'Play'}
          variant={store.playing ? 'soft' : 'solid'}
          onclick={() => store.togglePlay()}
        />
        <span class="beatdot" class:lit={onBeat} aria-hidden="true"></span>
        <span class="clock">{bar}.{beatInBar}</span>
        <label class="bpb"><span class="sel-wrap"><Select value={String(store.beatsPerBar)} options={BPB_OPTS} onChange={(v) => (store.beatsPerBar = Number(v))} ariaLabel="Beats per bar" /></span></label>
      </div>
      <StatusBar {store} />
      <label>bpm <span class="sld"><Slider min={60} max={200} bind:value={store.bpm} showValue={false} ariaLabel="Tempo" /></span><b>{store.bpm}</b><button class="tap" onclick={tap}>TAP</button></label>
      <label>vel <span class="sld"><Slider min={0} max={1} step={0.01} bind:value={store.velocity} showValue={false} ariaLabel="Velocity" /></span><b>{Math.round(store.velocity * 100)}</b></label>
      <button class="panic" onclick={() => store.panic()}>Stop all</button>
    </div>
  </header>

  <!-- ── section recall bar (branch 3 — timed morph) ────────────────────── -->
  <section class="sections">
    <span class="seclabel">Sections</span>
    {#each store.sections as s (s.id)}
      <button class="scene" class:active={store.activeSectionId === s.id} onclick={() => store.recall(s.id)}>{s.name}</button>
    {/each}
  </section>

  <div class="body">
    <!-- ── left: play surface + trigger-tree canvas (branch 2) ──────────── -->
    <main class="main">
      <section class="pads">
        {#each store.drums as drum (drum.id)}
          {@const drumPads = store.pads.filter((p) => p.drumId === drum.id)}
          <div class="padrow">
            <span class="drum">{drum.label}</span>
            {#each drumPads as p (padKey(p))}
              {@const i = store.pads.indexOf(p)}
              <button class="pad" class:sel={store.selectedPadKey === padKey(p)} onclick={() => fire(p)}>
                <span class="zone">{p.zoneLabel}</span>
                <span class="root">{p.tree.kind}</span>
                {#if i < 9}<span class="key">{i + 1}</span>{/if}
              </button>
            {/each}
          </div>
        {/each}
      </section>

      <section class="canvaswrap">
        <header class="panelhead">
          <h2>Trigger graph</h2>
          {#if store.selectedPad}<span class="ctx">{store.selectedPad.drumLabel} · {store.selectedPad.zoneLabel}</span>{/if}
          <span class="spacer"></span>
          <span class="hint">scroll = zoom · drag = pan · + adds a node</span>
        </header>
        <NodeCanvas {store} />
      </section>
    </main>

    <!-- ── right rail: kit preview + voice lanes + log ──────────────────── -->
    <aside class="rail">
      <section class="preview">
        <span class="vlabel">Kit preview · live composite</span>
        <span class="vtoggle">
          <SegmentedControl value={previewMode} options={PREVIEW_OPTS} onChange={(v) => (previewMode = v as '3d' | '2d')} ariaLabel="Preview mode" />
        </span>
        <!-- preview the REAL server output when the engine link is open, else the
             local sim composite (offline = local preview) -->
        {#if previewMode === '3d'}
          <Scene model={store.model} frame={previewFrame} />
        {:else}
          <Pixels2D model={store.model} frame={previewFrame} />
        {/if}
      </section>

      <section class="lanes">
        {#each store.buses as bus (bus.id)}
          {@const voices = store.voices.filter((v) => v.busId === bus.id)}
          <div class="lane">
            <div class="lanehead">
              <span class="busname">
                {#if busIcon[bus.id]}{@const I = busIcon[bus.id]}<I size={14} aria-hidden="true" />{/if}
                {bus.name}
              </span>
              <SegmentedControl
                value={bus.polyphony}
                options={POLY_OPTS}
                onChange={(v) => store.setPolyphony(bus.id, v as Polyphony)}
                ariaLabel="Bus polyphony"
              />
              <label class="xfade">xfade
                <span class="xfwrap"><Slider min={60} max={2000} step={20} value={bus.crossfadeMs} onChange={(v) => store.setCrossfade(bus.id, v)} showValue={false} ariaLabel="Crossfade time" /></span>
                <b>{bus.crossfadeMs}</b>
              </label>
              <div class="meter" aria-hidden="true"><span style="transform:scaleX({store.busLevels[bus.id] ?? 0})"></span></div>
              <button class="stopbus" onclick={() => store.stopBus(bus.id)} title="Release this bus">stop</button>
            </div>
            <div class="voices" class:empty={voices.length === 0}>
              {#if voices.length === 0}
                <span class="silent">— silent —</span>
              {:else}
                {#each voices as v (v.id)}
                  <div class="voice" class:releasing={v.phase === 'release'} style={voiceStyle(v)}>
                    <span class="vname">
                      {#if v.mode === 'oneshot'}<Zap size={12} aria-hidden="true" />{:else if v.mode === 'loop'}<Repeat size={12} aria-hidden="true" />{:else}<Hand size={12} aria-hidden="true" />{/if}
                      {store.sim.effectName(v.effectId)}
                    </span>
                    <span class="vvia">{v.via}</span>
                    <span class="vbar" style="transform:scaleX({vlevel(v).toFixed(3)})"></span>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/each}
      </section>

      <section class="logpanel">
        <header class="panelhead"><h2>Resolution log</h2></header>
        <div class="log scroll">
          {#each store.log as e, i (i + '-' + e.t)}
            <div class="logentry">
              <span class="lpad">{e.pad}</span>
              {#each e.resolved as r (r)}<span class="lline">{r}</span>{/each}
            </div>
          {/each}
        </div>
      </section>
    </aside>
  </div>

  <EffectGallery {store} />
  <ClipSettings {store} />
  <EnvelopeEditor {store} />
  <EffectCreator {store} />
</div>

<style>
  .lab {
    height: 100vh;
    width: 100vw;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--bg);
    color: var(--text);
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  h1,
  h2 {
    margin: 0;
  }
  .spacer {
    flex: 1;
  }

  /* header */
  .top {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .mark {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-1);
    background: conic-gradient(from 200deg, var(--role-input), var(--role-content), var(--role-effect), var(--role-layer), var(--role-output), var(--role-input));
  }
  .brand h1 {
    font-size: var(--text-md);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    color: var(--ink);
  }
  .tag {
    font-size: var(--text-2xs);
    color: var(--warn);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .readout {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .readout label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .readout .sld {
    display: flex;
    width: 92px;
  }
  .readout b {
    font-family: var(--font-mono);
    color: var(--ink);
    min-width: 26px;
    font-variant-numeric: tabular-nums;
  }
  .clock {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    color: var(--accent);
    min-width: 54px;
    font-variant-numeric: tabular-nums;
  }
  .transport {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .beatdot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    transition:
      background-color 60ms ease,
      box-shadow 60ms ease,
      border-color 60ms ease;
  }
  .beatdot.lit {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 10px var(--accent);
  }
  .bpb {
    gap: var(--space-1);
  }
  .bpb .sel-wrap {
    display: inline-flex;
    min-width: 58px;
  }
  .tap {
    padding: 2px var(--space-2);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    letter-spacing: var(--tracking-label);
  }
  .panic {
    color: var(--live);
    border-color: color-mix(in oklch, var(--live) 45%, var(--border));
  }

  /* sections */
  .sections {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
  }
  .seclabel {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    margin-right: var(--space-2);
  }
  .scene {
    padding: var(--space-1) var(--space-3);
  }
  .scene.active {
    background: var(--accent-soft);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
    color: var(--ink);
  }
  /* body split: author (left) · monitor rail (right) */
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(360px, 32vw, 480px);
    gap: var(--space-3);
    min-height: 0;
  }
  .main {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
  }
  .canvaswrap {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    min-height: 0;
  }
  .rail {
    display: grid;
    grid-template-rows: minmax(180px, 0.95fr) minmax(0, 1.15fr) minmax(0, 0.7fr);
    gap: var(--space-3);
    min-height: 0;
  }
  .preview {
    position: relative;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-perform);
    border: 1px solid var(--border-faint);
  }
  .vlabel {
    position: absolute;
    top: var(--space-2);
    left: var(--space-3);
    z-index: 1;
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    pointer-events: none;
  }
  .vtoggle {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    z-index: 1;
  }

  /* pads */
  .pads {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
  }
  .padrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .drum {
    width: 56px;
    flex: none;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .pad {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 96px;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
  }
  .pad:active {
    transform: translateY(1px);
  }
  .pad.sel {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 45%, transparent);
  }
  .pad .zone {
    font-size: var(--text-sm);
    color: var(--ink);
    font-weight: 600;
  }
  .pad .root {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--accent);
    text-transform: uppercase;
  }
  .pad .key {
    position: absolute;
    top: var(--space-1);
    right: var(--space-2);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-disabled);
  }

  /* lanes / voices */
  .lanes {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    overflow: auto;
  }
  .lane {
    display: grid;
    grid-template-rows: auto minmax(72px, 1fr);
    background: var(--surface);
    border: 1px solid var(--border-faint);
  }
  .lanehead {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
    background: var(--surface-2);
  }
  .busname {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ink);
    min-width: 64px;
  }
  .busname :global(.lucide) {
    color: var(--accent);
    flex: none;
  }
  .xfade {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .xfade .xfwrap {
    display: flex;
    width: 84px;
  }
  .xfade b {
    font-family: var(--font-mono);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .meter {
    flex: 1;
    height: 6px;
    background: var(--surface-inset);
    border-radius: var(--radius-pill);
    overflow: hidden;
    min-width: 40px;
  }
  .meter span {
    display: block;
    height: 100%;
    width: 100%;
    transform-origin: left;
    background: linear-gradient(90deg, var(--accent-dim), var(--accent));
    transition: transform 60ms linear;
  }
  .stopbus {
    padding: 2px var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .voices {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    min-height: 0;
  }
  .voices.empty {
    align-items: center;
  }
  .silent {
    color: var(--text-disabled);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }
  .voice {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 132px;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  .voice.releasing {
    opacity: 0.92;
    outline: 1px dashed color-mix(in oklch, var(--text-faint) 60%, transparent);
    outline-offset: -3px;
  }
  .vname {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .vname :global(.lucide) {
    flex: none;
    opacity: 0.85;
  }
  .vvia {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: color-mix(in oklch, var(--ink) 75%, transparent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vbar {
    height: 3px;
    width: 100%;
    transform-origin: left;
    border-radius: var(--radius-pill);
    background: oklch(0.97 0 0 / 0.8);
    margin-top: var(--space-1);
  }

  .logpanel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    min-height: 0;
  }
  .panelhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .panelhead h2 {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  .ctx {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--accent);
  }
  .scroll {
    overflow: auto;
    min-height: 0;
  }
  .hint {
    color: var(--text-faint);
    font-size: var(--text-xs);
    margin: 0;
  }
  .log {
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-family: var(--font-mono);
  }
  .logentry {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--border-faint);
  }
  .lpad {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .lline {
    font-size: var(--text-xs);
    color: var(--text);
  }
</style>
