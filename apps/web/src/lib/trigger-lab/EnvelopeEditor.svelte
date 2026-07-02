<script lang="ts">
  /* ADSR envelope editor (throwaway). A modal that opens when store.envTarget is
     set. Edits an AdsrShape by dragging three stage handles on a hand-rolled SVG
     curve — Vital/Serum-style. v2 (S24): the Attack handle is draggable in Y to set
     `attackLevel` (the peak it rises to), and each segment (attack/decay/release)
     carries its own easing, chosen per-segment via the EasePicker — the old single
     Curve slider is gone. The store turns the shape into the persisted render curve
     (adsrToPoints), so it stays the single source of truth: every drag/pick rebuilds
     the next AdsrShape and calls store.setEnvAdsr. No charting library.

     All handle↔shape geometry is pure and unit-tested in `envelope-editor-geom.ts`;
     this component is a thin, accessible view over it. */
  import Dialog from '../ui/Dialog.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Slider from '../ui/Slider.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import EasePicker from '../ui/EasePicker.svelte';
  import X from '@lucide/svelte/icons/x';
  import Spline from '@lucide/svelte/icons/spline';
  import { type AdsrShape, type EaseSpec, defaultAdsr, adsrToPoints } from './sim';
  import {
    GEO,
    xOf,
    yOf,
    toUnit,
    handleAnchors,
    segmentBands,
    dragAttack,
    dragSustain,
    dragRelease,
    NUDGE,
    type Stage,
  } from './envelope-editor-geom';
  import type { Attachment } from 'svelte/attachments';
  import type { TriggerLab } from './store.svelte';

  let { store }: { store: TriggerLab } = $props();

  // --- target + spec -------------------------------------------------------
  const target = $derived(store.envTarget);
  const spec = $derived.by(() => {
    const t = store.envTarget;
    if (!t) return undefined;
    const eff = store.effectOf(t.block);
    return eff?.params.find((s) => s.key === t.key);
  });
  const env = $derived(target ? store.getEnvelope(target.block, target.key) : null);

  const paramLabel = $derived(spec?.label ?? 'Parameter');
  const min = $derived(spec?.min ?? 0);
  const max = $derived(spec?.max ?? 1);
  const unit = $derived(spec?.unit ?? '');

  // The live ADSR — store is the source of truth. We never mirror it; each edit
  // computes a fresh shape and persists it, and this re-derives reactively.
  const adsr = $derived(target ? store.getEnvelope(target.block, target.key)?.adsr ?? defaultAdsr() : defaultAdsr());

  /** Persist a partial change to the ADSR (creates the envelope if missing). */
  function commit(patch: Partial<AdsrShape>): void {
    if (!target) return;
    store.setEnvAdsr(target.block, target.key, { ...adsr, ...patch });
  }

  // --- quick presets (v2: explicit per-segment eases) ----------------------
  const PRESETS: Record<string, AdsrShape> = {
    pluck: {
      attack: 0.02, decay: 0.18, sustain: 0.18, release: 0.22, attackLevel: 1,
      attackEase: { fn: 'linear', dir: 'in' }, decayEase: { fn: 'expo', dir: 'out' }, releaseEase: { fn: 'expo', dir: 'out' },
    },
    stab: {
      attack: 0, decay: 0.16, sustain: 0, release: 0.1, attackLevel: 1,
      attackEase: { fn: 'linear', dir: 'in' }, decayEase: { fn: 'quart', dir: 'out' }, releaseEase: { fn: 'quad', dir: 'out' },
    },
    swell: {
      attack: 0.4, decay: 0.15, sustain: 0.85, release: 0.45, attackLevel: 1,
      attackEase: { fn: 'sine', dir: 'in' }, decayEase: { fn: 'sine', dir: 'inOut' }, releaseEase: { fn: 'sine', dir: 'out' },
    },
    gate: {
      attack: 0, decay: 0, sustain: 1, release: 0, attackLevel: 1,
      attackEase: { fn: 'linear', dir: 'in' }, decayEase: { fn: 'linear', dir: 'in' }, releaseEase: { fn: 'linear', dir: 'in' },
    },
  };
  const presetOptions = [
    { value: 'pluck', label: 'Pluck' },
    { value: 'stab', label: 'Stab' },
    { value: 'swell', label: 'Swell' },
    { value: 'gate', label: 'Gate' },
  ];
  function pickPreset(value: string): void {
    const p = PRESETS[value];
    if (p && target) store.setEnvAdsr(target.block, target.key, { ...p });
  }

  // --- SVG geometry (constants + mapping live in envelope-editor-geom) ------
  const innerW = GEO.W - GEO.PAD * 2;
  const innerH = GEO.H - GEO.PAD * 2;

  // Handle anchors + selectable segment bands, derived from the live shape.
  const anchors = $derived(handleAnchors(adsr));
  const attackT = $derived(anchors.attack.t);
  const attackPeak = $derived(anchors.attack.v);
  const sustainT = $derived(anchors.sustain.t);
  const sustainV = $derived(anchors.sustain.v);
  const releaseT = $derived(anchors.release.t);
  const bands = $derived(segmentBands(adsr));

  const points = $derived(adsrToPoints(adsr));
  const linePath = $derived(points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.t)},${yOf(p.v)}`).join(' '));
  const areaPath = $derived.by(() => {
    if (points.length === 0) return '';
    const top = points.map((p) => `L${xOf(p.t)},${yOf(p.v)}`).join(' ');
    const baseY = yOf(0);
    return `M${xOf(points[0]!.t)},${baseY} ${top} L${xOf(points[points.length - 1]!.t)},${baseY} Z`;
  });

  // Grid guides at quarter divisions.
  const gridX = [0.25, 0.5, 0.75];
  const gridY = [0.25, 0.5, 0.75];

  // --- dragging ------------------------------------------------------------
  // Capture the SVG node via an attachment so drag math can read its box.
  let svgEl: SVGSVGElement | undefined = $state();
  const captureSvg: Attachment<SVGSVGElement> = (node) => {
    svgEl = node;
    return () => {
      if (svgEl === node) svgEl = undefined;
    };
  };

  /** Which handle is being dragged — attack, the decay/sustain node, or release. */
  type DragHandle = 'attack' | 'sustain' | 'release';
  let dragStage = $state<DragHandle | null>(null);

  function applyDrag(handle: DragHandle, t: number, v: number): void {
    if (handle === 'attack') commit(dragAttack(adsr, t, v));
    else if (handle === 'sustain') commit(dragSustain(adsr, t, v));
    else commit(dragRelease(adsr, t));
  }

  function onHandleDown(e: PointerEvent, handle: DragHandle): void {
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragStage = handle;
    // Selecting the segment a handle owns surfaces its ease controls on grab.
    selectedSegment = handle === 'sustain' ? 'decay' : handle;
  }

  function onHandleMove(e: PointerEvent): void {
    if (dragStage === null || !target || !svgEl) return;
    const { t, v } = toUnit(e.clientX, e.clientY, svgEl.getBoundingClientRect());
    applyDrag(dragStage, t, v);
  }

  function onHandleUp(e: PointerEvent): void {
    if (dragStage === null) return;
    const el = e.currentTarget as Element;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dragStage = null;
  }

  /** Keyboard operation: arrows nudge the focused handle; Enter/Space selects its
      segment for ease editing. Attack + the decay/sustain node move in X and Y;
      release is X-only (its Y tracks sustain). */
  function onHandleKey(e: KeyboardEvent, handle: DragHandle): void {
    if (!target) return;
    const A = handleAnchors(adsr);
    const cur = handle === 'attack' ? A.attack : handle === 'sustain' ? A.sustain : A.release;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': applyDrag(handle, cur.t - NUDGE, cur.v); break;
      case 'ArrowRight': applyDrag(handle, cur.t + NUDGE, cur.v); break;
      case 'ArrowUp': if (handle !== 'release') applyDrag(handle, cur.t, cur.v + NUDGE); else handled = false; break;
      case 'ArrowDown': if (handle !== 'release') applyDrag(handle, cur.t, cur.v - NUDGE); else handled = false; break;
      case 'Enter':
      case ' ': selectedSegment = handle === 'sustain' ? 'decay' : handle; break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  // --- per-segment easing --------------------------------------------------
  const SEGMENTS: Stage[] = ['attack', 'decay', 'release'];
  const segmentOptions = [
    { value: 'attack', label: 'Attack' },
    { value: 'decay', label: 'Decay' },
    { value: 'release', label: 'Release' },
  ];
  let selectedSegment = $state<Stage>('attack');

  const LINEAR: EaseSpec = { fn: 'linear', dir: 'in' };
  /** The ease shown for a segment — an authored EaseSpec, else linear (the default
      the v2 renderer falls back to when a segment has no explicit ease). */
  function segEaseOf(seg: Stage): EaseSpec {
    return adsr[`${seg}Ease`] ?? LINEAR;
  }
  const selectedEase = $derived(segEaseOf(selectedSegment));

  function setSegEase(spec: EaseSpec): void {
    const patch: Partial<AdsrShape> = {};
    patch[`${selectedSegment}Ease`] = spec;
    commit(patch);
  }
  function selectSegment(seg: Stage): void {
    selectedSegment = seg;
  }

  // --- amount --------------------------------------------------------------
  const amount = $derived(env?.amount ?? 1);
  function setAmount(v: number): void {
    if (target) store.setEnvAmount(target.block, target.key, v);
  }
  function removeEnvelope(): void {
    if (target) store.setEnvKind(target.block, target.key, 'none');
  }

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const fix2 = (v: number): string => v.toFixed(2);

  // Human-readable state for each handle's aria-valuetext (2D sliders).
  const attackAria = $derived(`Attack time ${pct(attackT)}, peak level ${pct(attackPeak)}`);
  const sustainAria = $derived(`Decay ${fix2(adsr.decay)}, sustain level ${pct(sustainV)}`);
  const releaseAria = $derived(`Release ${fix2(adsr.release)}`);
</script>

<Dialog open={!!store.envTarget} onClose={() => store.closeEnv()} title="Envelope" layer={2} class="dlg-envedit">
  {#if target && spec}
    <header class="ehead">
      <Eyebrow icon={Spline}>Envelope · {paramLabel}</Eyebrow>
      <span class="grow"></span>
      <IconButton icon={X} label="Close" onclick={() => store.closeEnv()} variant="ghost" />
    </header>

    <div class="presets">
      <SegmentedControl value="" options={presetOptions} onChange={pickPreset} ariaLabel="ADSR preset" />
    </div>

    <div class="editor">
      <svg
        {@attach captureSvg}
        class="curve"
        viewBox="0 0 {GEO.W} {GEO.H}"
        preserveAspectRatio="none"
        role="application"
        aria-label="{paramLabel} ADSR envelope"
      >
        <!-- frame + grid -->
        <rect class="frame" x={GEO.PAD} y={GEO.PAD} width={innerW} height={innerH} />
        {#each gridX as gx (gx)}
          <line class="grid" x1={xOf(gx)} y1={GEO.PAD} x2={xOf(gx)} y2={GEO.H - GEO.PAD} />
        {/each}
        {#each gridY as gy (gy)}
          <line class="grid" x1={GEO.PAD} y1={yOf(gy)} x2={GEO.W - GEO.PAD} y2={yOf(gy)} />
        {/each}
        <line class="baseline" x1={GEO.PAD} y1={yOf(0)} x2={GEO.W - GEO.PAD} y2={yOf(0)} />

        <!-- clickable segment bands (select a segment to edit its easing) -->
        {#each SEGMENTS as seg (seg)}
          {@const b = bands[seg]}
          <rect
            class="seg-band"
            class:selected={selectedSegment === seg}
            x={xOf(b[0])}
            y={GEO.PAD}
            width={Math.max(0, xOf(b[1]) - xOf(b[0]))}
            height={innerH}
            onclick={() => selectSegment(seg)}
            role="presentation"
          />
        {/each}

        <!-- filled area + curve (pointer-transparent so bands under it stay clickable) -->
        <path class="area" d={areaPath} />
        <path class="line" d={linePath} />

        <!-- fixed endpoints (start + end at level 0) -->
        <circle class="anchor" cx={xOf(0)} cy={yOf(0)} r="3" />
        <circle class="anchor" cx={xOf(1)} cy={yOf(0)} r="3" />

        <!-- stage handles: Attack (X+Y → attackLevel), Sustain (X+Y), Release (X) -->
        <g
          class="handle"
          class:active={dragStage === 'attack'}
          onpointerdown={(e) => onHandleDown(e, 'attack')}
          onpointermove={onHandleMove}
          onpointerup={onHandleUp}
          onpointercancel={onHandleUp}
          onkeydown={(e) => onHandleKey(e, 'attack')}
          role="slider"
          tabindex="0"
          aria-label="Attack handle"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={attackPeak}
          aria-valuetext={attackAria}
        >
          <circle class="hit" cx={xOf(attackT)} cy={yOf(attackPeak)} r="16" />
          <circle class="dot" cx={xOf(attackT)} cy={yOf(attackPeak)} r="7" />
          <text class="cap" x={xOf(attackT)} y={yOf(attackPeak) - 12} text-anchor="middle">A</text>
        </g>

        <g
          class="handle"
          class:active={dragStage === 'sustain'}
          onpointerdown={(e) => onHandleDown(e, 'sustain')}
          onpointermove={onHandleMove}
          onpointerup={onHandleUp}
          onpointercancel={onHandleUp}
          onkeydown={(e) => onHandleKey(e, 'sustain')}
          role="slider"
          tabindex="0"
          aria-label="Decay and sustain handle"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={sustainV}
          aria-valuetext={sustainAria}
        >
          <circle class="hit" cx={xOf(sustainT)} cy={yOf(sustainV)} r="16" />
          <circle class="dot" cx={xOf(sustainT)} cy={yOf(sustainV)} r="7" />
          <text class="cap" x={xOf(sustainT)} y={yOf(sustainV) - 12} text-anchor="middle">D·S</text>
        </g>

        <g
          class="handle"
          class:active={dragStage === 'release'}
          onpointerdown={(e) => onHandleDown(e, 'release')}
          onpointermove={onHandleMove}
          onpointerup={onHandleUp}
          onpointercancel={onHandleUp}
          onkeydown={(e) => onHandleKey(e, 'release')}
          role="slider"
          tabindex="0"
          aria-label="Release handle"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={releaseT}
          aria-valuetext={releaseAria}
        >
          <circle class="hit" cx={xOf(releaseT)} cy={yOf(sustainV)} r="16" />
          <circle class="dot" cx={xOf(releaseT)} cy={yOf(sustainV)} r="7" />
          <text class="cap" x={xOf(releaseT)} y={yOf(sustainV) - 12} text-anchor="middle">R</text>
        </g>
      </svg>

      <div class="readouts">
        <span class="ro"><b>A</b>{fix2(attackT)}</span>
        <span class="ro"><b>P</b>{pct(attackPeak)}</span>
        <span class="ro"><b>D</b>{fix2(adsr.decay)}</span>
        <span class="ro"><b>S</b>{fix2(sustainV)}</span>
        <span class="ro"><b>R</b>{fix2(adsr.release)}</span>
      </div>
    </div>

    <div class="row">
      <Eyebrow>Segment</Eyebrow>
      <SegmentedControl
        value={selectedSegment}
        options={segmentOptions}
        onChange={(v) => selectSegment(v as Stage)}
        ariaLabel="Easing segment"
      />
    </div>

    <div class="row">
      <Eyebrow>Ease</Eyebrow>
      <EasePicker value={selectedEase} onChange={setSegEase} ariaLabel="{selectedSegment} easing" class="ease-row" />
    </div>

    <div class="row">
      <Eyebrow>Amount</Eyebrow>
      <Slider value={amount} min={0} max={1} step={0.01} onChange={setAmount} format={pct} ariaLabel="Sweep amount" />
    </div>

    <footer class="foot">
      <p class="hint">
        {paramLabel} sweeps across {min}–{max}{unit} as the hit plays. Drag the Attack node up for its
        peak level; pick each segment's easing above. Amount scales the depth.
      </p>
      <button class="remove" type="button" onclick={removeEnvelope}>Remove envelope</button>
    </footer>
  {/if}
</Dialog>

<style>
  :global(.dlg-envedit) {
    width: min(520px, 94vw);
  }

  .ehead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .grow {
    flex: 1;
  }

  .presets {
    padding: var(--space-3) var(--space-4) 0;
  }

  .editor {
    padding: var(--space-3) var(--space-4);
  }
  .curve {
    display: block;
    width: 100%;
    height: 160px;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    touch-action: none;
  }

  .frame {
    fill: none;
    stroke: var(--border-faint);
    stroke-width: 1;
  }
  .grid {
    stroke: var(--border-faint);
    stroke-width: 1;
    stroke-dasharray: 2 4;
    opacity: 0.6;
  }
  .baseline {
    stroke: var(--border-strong);
    stroke-width: 1;
  }

  /* Selectable segment columns — transparent until hovered/selected. */
  .seg-band {
    fill: var(--accent);
    opacity: 0;
    cursor: pointer;
    transition: opacity var(--dur-120) ease;
  }
  .seg-band:hover {
    opacity: 0.05;
  }
  .seg-band.selected {
    opacity: 0.12;
  }

  .area {
    fill: var(--accent);
    opacity: 0.16;
    pointer-events: none;
  }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
    pointer-events: none;
  }

  .anchor {
    fill: var(--surface-inset);
    stroke: var(--border-strong);
    stroke-width: 1.5;
    pointer-events: none;
  }

  .handle {
    cursor: grab;
  }
  .handle.active {
    cursor: grabbing;
  }
  .handle:focus-visible {
    outline: none;
  }
  .hit {
    fill: transparent;
    stroke: none;
  }
  .dot {
    fill: var(--ink);
    stroke: var(--accent);
    stroke-width: 2;
    transition: stroke var(--dur-120) ease;
  }
  .handle:hover .dot {
    stroke: var(--accent-bright);
  }
  .handle.active .dot,
  .handle:focus-visible .dot {
    stroke: var(--accent-bright);
    fill: var(--accent-soft);
  }
  /* Keyboard focus ring on the SVG handle (focus-visible has no default outline
     inside SVG in most engines). */
  .handle:focus-visible .hit {
    fill: var(--accent-soft);
    opacity: 0.25;
  }
  .cap {
    fill: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: var(--tracking-label);
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--dur-120) ease;
  }
  .handle:hover .cap,
  .handle.active .cap,
  .handle:focus-visible .cap {
    opacity: 1;
    fill: var(--accent-bright);
  }

  .readouts {
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .ro b {
    color: var(--text-faint);
    font-weight: 600;
    margin-right: 4px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-4) var(--space-3);
  }
  .row :global(.eyebrow) {
    min-width: 56px;
  }
  .row :global(.ease-row) {
    flex: 1;
  }

  .foot {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-faint);
  }
  .hint {
    flex: 1;
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    line-height: 1.5;
    text-wrap: pretty;
  }
  .remove {
    flex: none;
    background: transparent;
    border: none;
    padding: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    transition: color var(--dur-120) ease;
    white-space: nowrap;
  }
  .remove:hover {
    color: var(--accent-bright);
  }

  @media (prefers-reduced-motion: reduce) {
    .seg-band,
    .dot,
    .cap,
    .remove {
      transition: none;
    }
  }
</style>
