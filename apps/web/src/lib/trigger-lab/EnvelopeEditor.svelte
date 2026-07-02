<script lang="ts">
  /* ADSR envelope editor (throwaway). A modal that opens when store.envTarget is
     set. Edits an AdsrShape (attack/decay/sustain/release + segment curve) by
     dragging three stage handles on a hand-rolled SVG curve — Vital/Serum-style.
     The store turns the shape into the persisted render curve (adsrToPoints), so
     it stays the single source of truth: every drag/slider rebuilds the next
     AdsrShape and calls store.setEnvAdsr. No charting library. */
  import Dialog from '../ui/Dialog.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Slider from '../ui/Slider.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import X from '@lucide/svelte/icons/x';
  import Spline from '@lucide/svelte/icons/spline';
  import { type AdsrShape, defaultAdsr, adsrToPoints } from './sim';
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

  // --- quick presets -------------------------------------------------------
  const PRESETS: Record<string, AdsrShape> = {
    pluck: { attack: 0.02, decay: 0.18, sustain: 0.18, release: 0.22, curve: 0.55 },
    stab: { attack: 0, decay: 0.16, sustain: 0, release: 0.1, curve: 0.4 },
    swell: { attack: 0.4, decay: 0.15, sustain: 0.85, release: 0.45, curve: -0.3 },
    gate: { attack: 0, decay: 0, sustain: 1, release: 0, curve: 0 },
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

  // --- SVG geometry --------------------------------------------------------
  const W = 480;
  const H = 160;
  const PAD = 10; // inner padding so endpoint/stage handles never clip
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;

  const xOf = (t: number): number => PAD + t * innerW;
  const yOf = (v: number): number => PAD + (1 - v) * innerH; // invert: v=0 bottom, v=1 top

  const clampUnit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

  // Stage handle anchor positions in (t, v) space.
  const attackT = $derived(clampUnit(adsr.attack));
  const sustainT = $derived(clampUnit(adsr.attack + adsr.decay));
  const sustainV = $derived(clampUnit(adsr.sustain));
  const releaseT = $derived(clampUnit(1 - adsr.release));

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

  type Stage = 'attack' | 'sustain' | 'release';
  let dragStage = $state<Stage | null>(null);

  /** Map a pointer position to envelope (t, v) using the SVG's box. */
  function toUnit(clientX: number, clientY: number): { t: number; v: number } {
    if (!svgEl) return { t: 0, v: 0 };
    const r = svgEl.getBoundingClientRect();
    // CSS pixels → viewBox units (the SVG scales to its box).
    const px = ((clientX - r.left) / r.width) * W;
    const py = ((clientY - r.top) / r.height) * H;
    const t = clampUnit((px - PAD) / innerW);
    const v = clampUnit(1 - (py - PAD) / innerH);
    return { t, v };
  }

  function onHandleDown(e: PointerEvent, stage: Stage): void {
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragStage = stage;
  }

  function onHandleMove(e: PointerEvent): void {
    if (dragStage === null || !target) return;
    const { t, v } = toUnit(e.clientX, e.clientY);
    if (dragStage === 'attack') {
      // X only — keep attack ≤ attack+decay ≤ 1−release.
      const a = clamp(t, 0, Math.min(0.9, sustainT, releaseT));
      const decay = Math.max(0, sustainT - a);
      commit({ attack: a, decay });
    } else if (dragStage === 'sustain') {
      // X sets decay (relative to attack), Y sets sustain level.
      const x = clamp(t, attackT, releaseT);
      const decay = Math.max(0, x - attackT);
      commit({ decay, sustain: clampUnit(v) });
    } else {
      // Release X only — its Y tracks sustain, not draggable.
      const x = clamp(t, sustainT, 1);
      commit({ release: clamp(1 - x, 0, 0.9) });
    }
  }

  function onHandleUp(e: PointerEvent): void {
    if (dragStage === null) return;
    const el = e.currentTarget as Element;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dragStage = null;
  }

  // --- curve / amount ------------------------------------------------------
  function setCurve(v: number): void {
    commit({ curve: v });
  }
  const amount = $derived(env?.amount ?? 1);
  function setAmount(v: number): void {
    if (target) store.setEnvAmount(target.block, target.key, v);
  }
  function removeEnvelope(): void {
    if (target) store.setEnvKind(target.block, target.key, 'none');
  }

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const fix2 = (v: number): string => v.toFixed(2);
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
        viewBox="0 0 {W} {H}"
        preserveAspectRatio="none"
        role="application"
        aria-label="{paramLabel} ADSR envelope"
      >
        <!-- frame + grid -->
        <rect class="frame" x={PAD} y={PAD} width={innerW} height={innerH} />
        {#each gridX as gx (gx)}
          <line class="grid" x1={xOf(gx)} y1={PAD} x2={xOf(gx)} y2={H - PAD} />
        {/each}
        {#each gridY as gy (gy)}
          <line class="grid" x1={PAD} y1={yOf(gy)} x2={W - PAD} y2={yOf(gy)} />
        {/each}
        <line class="baseline" x1={PAD} y1={yOf(0)} x2={W - PAD} y2={yOf(0)} />

        <!-- filled area + curve -->
        <path class="area" d={areaPath} />
        <path class="line" d={linePath} />

        <!-- fixed endpoints (start + end at level 0) -->
        <circle class="anchor" cx={xOf(0)} cy={yOf(0)} r="3" />
        <circle class="anchor" cx={xOf(1)} cy={yOf(0)} r="3" />

        <!-- stage handles: Attack (X), Sustain (X+Y), Release (X) -->
        <g
          class="handle"
          class:active={dragStage === 'attack'}
          onpointerdown={(e) => onHandleDown(e, 'attack')}
          onpointermove={onHandleMove}
          onpointerup={onHandleUp}
          onpointercancel={onHandleUp}
          role="presentation"
        >
          <circle class="hit" cx={xOf(attackT)} cy={yOf(1)} r="16" />
          <circle class="dot" cx={xOf(attackT)} cy={yOf(1)} r="7" />
          <text class="cap" x={xOf(attackT)} y={yOf(1) - 12} text-anchor="middle">A</text>
        </g>

        <g
          class="handle"
          class:active={dragStage === 'sustain'}
          onpointerdown={(e) => onHandleDown(e, 'sustain')}
          onpointermove={onHandleMove}
          onpointerup={onHandleUp}
          onpointercancel={onHandleUp}
          role="presentation"
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
          role="presentation"
        >
          <circle class="hit" cx={xOf(releaseT)} cy={yOf(sustainV)} r="16" />
          <circle class="dot" cx={xOf(releaseT)} cy={yOf(sustainV)} r="7" />
          <text class="cap" x={xOf(releaseT)} y={yOf(sustainV) - 12} text-anchor="middle">R</text>
        </g>
      </svg>

      <div class="readouts">
        <span class="ro"><b>A</b>{fix2(attackT)}</span>
        <span class="ro"><b>D</b>{fix2(adsr.decay)}</span>
        <span class="ro"><b>S</b>{fix2(sustainV)}</span>
        <span class="ro"><b>R</b>{fix2(adsr.release)}</span>
      </div>
    </div>

    <div class="row">
      <Eyebrow>Curve</Eyebrow>
      <Slider value={adsr.curve ?? 0} min={-1} max={1} step={0.05} onChange={setCurve} format={fix2} ariaLabel="Segment curve" />
    </div>

    <div class="row">
      <Eyebrow>Amount</Eyebrow>
      <Slider value={amount} min={0} max={1} step={0.01} onChange={setAmount} format={pct} ariaLabel="Sweep amount" />
    </div>

    <footer class="foot">
      <p class="hint">
        {paramLabel} sweeps across {min}–{max}{unit} as the hit plays; Amount scales the depth.
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

  .area {
    fill: var(--accent);
    opacity: 0.16;
  }
  .line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .anchor {
    fill: var(--surface-inset);
    stroke: var(--border-strong);
    stroke-width: 1.5;
  }

  .handle {
    cursor: grab;
  }
  .handle.active {
    cursor: grabbing;
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
  .handle.active .dot {
    stroke: var(--accent-bright);
    fill: var(--accent-soft);
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
  .handle.active .cap {
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
</style>
