<script lang="ts">
  /* Prop-driven ADSR shape editor — the reusable BODY extracted from EnvelopeEditor.svelte
     (S34): presets + the draggable SVG curve + per-segment easing. It owns no store binding;
     the host passes the live `adsr` and an `onShape` callback that persists a fresh shape. This
     is the "clean, mechanical" view extraction the S24 handoff anticipated, so both the modal
     (param envelopes) and the Envelope NODE inspector (modulation source) drive one editor.

     All handle↔shape geometry stays pure + unit-tested in `envelope-editor-geom.ts`; this is a
     thin, accessible view over it. */
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import EasePicker from '../ui/EasePicker.svelte';
  import { type AdsrShape, type EaseSpec, adsrToPoints } from './sim';
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

  interface Props {
    /** The live shape (host is the source of truth — this never mirrors it). */
    adsr: AdsrShape;
    /** Persist a fresh, whole shape (the view merges its own edits before calling). */
    onShape: (next: AdsrShape) => void;
    /** Aria label prefix for the curve + handles. */
    label?: string;
    /** Show the quick-preset row (default true). */
    presets?: boolean;
  }
  let { adsr, onShape, label = 'Envelope', presets = true }: Props = $props();

  /** Persist a partial change merged onto the current shape. */
  function commit(patch: Partial<AdsrShape>): void {
    onShape({ ...adsr, ...patch });
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
    if (p) onShape({ ...p });
  }

  // --- SVG geometry (constants + mapping live in envelope-editor-geom) ------
  const innerW = GEO.W - GEO.PAD * 2;
  const innerH = GEO.H - GEO.PAD * 2;

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

  const gridX = [0.25, 0.5, 0.75];
  const gridY = [0.25, 0.5, 0.75];

  // --- dragging ------------------------------------------------------------
  let svgEl: SVGSVGElement | undefined = $state();
  const captureSvg: Attachment<SVGSVGElement> = (node) => {
    svgEl = node;
    return () => {
      if (svgEl === node) svgEl = undefined;
    };
  };

  type DragHandle = 'attack' | 'sustain' | 'release';
  let dragStage = $state<DragHandle | null>(null);

  function applyDrag(handle: DragHandle, t: number, v: number): void {
    if (handle === 'attack') commit(dragAttack(adsr, t, v));
    else if (handle === 'sustain') commit(dragSustain(adsr, t, v));
    else commit(dragRelease(adsr, t));
  }

  function onHandleDown(e: PointerEvent, handle: DragHandle): void {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragStage = handle;
    selectedSegment = handle === 'sustain' ? 'decay' : handle;
  }

  function onHandleMove(e: PointerEvent): void {
    if (dragStage === null || !svgEl) return;
    const { t, v } = toUnit(e.clientX, e.clientY, svgEl.getBoundingClientRect());
    applyDrag(dragStage, t, v);
  }

  function onHandleUp(e: PointerEvent): void {
    if (dragStage === null) return;
    const el = e.currentTarget as Element;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dragStage = null;
  }

  function onHandleKey(e: KeyboardEvent, handle: DragHandle): void {
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

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const fix2 = (v: number): string => v.toFixed(2);

  const attackAria = $derived(`Attack time ${pct(attackT)}, peak level ${pct(attackPeak)}`);
  const sustainAria = $derived(`Decay ${fix2(adsr.decay)}, sustain level ${pct(sustainV)}`);
  const releaseAria = $derived(`Release ${fix2(adsr.release)}`);
</script>

{#if presets}
  <div class="presets">
    <SegmentedControl value="" options={presetOptions} onChange={pickPreset} ariaLabel="ADSR preset" />
  </div>
{/if}

<div class="editor">
  <svg
    {@attach captureSvg}
    class="curve"
    viewBox="0 0 {GEO.W} {GEO.H}"
    preserveAspectRatio="none"
    role="application"
    aria-label="{label} ADSR envelope"
  >
    <rect class="frame" x={GEO.PAD} y={GEO.PAD} width={innerW} height={innerH} />
    {#each gridX as gx (gx)}
      <line class="grid" x1={xOf(gx)} y1={GEO.PAD} x2={xOf(gx)} y2={GEO.H - GEO.PAD} />
    {/each}
    {#each gridY as gy (gy)}
      <line class="grid" x1={GEO.PAD} y1={yOf(gy)} x2={GEO.W - GEO.PAD} y2={yOf(gy)} />
    {/each}
    <line class="baseline" x1={GEO.PAD} y1={yOf(0)} x2={GEO.W - GEO.PAD} y2={yOf(0)} />

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

    <path class="area" d={areaPath} />
    <path class="line" d={linePath} />

    <circle class="anchor" cx={xOf(0)} cy={yOf(0)} r="3" />
    <circle class="anchor" cx={xOf(1)} cy={yOf(0)} r="3" />

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
  <span class="lbl">Segment</span>
  <SegmentedControl
    value={selectedSegment}
    options={segmentOptions}
    onChange={(v) => selectSegment(v as Stage)}
    ariaLabel="Easing segment"
  />
</div>

<div class="row">
  <span class="lbl">Ease</span>
  <EasePicker value={selectedEase} onChange={setSegEase} ariaLabel="{selectedSegment} easing" class="ease-row" />
</div>

<style>
  .presets {
    padding-bottom: var(--space-3);
  }
  .editor {
    padding-bottom: var(--space-3);
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
    padding-bottom: var(--space-3);
  }
  .lbl {
    min-width: 56px;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .row :global(.ease-row) {
    flex: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .seg-band,
    .dot,
    .cap {
      transition: none;
    }
  }
</style>
