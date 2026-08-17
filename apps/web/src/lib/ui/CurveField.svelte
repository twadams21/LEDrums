<script lang="ts" module>
  /* Re-exported so a consumer imports the component and its value shape from one
     place; the definitions live in the pure module. */
  export type { CurveValue, CurveHit, CurveProfile, CurveAxisSpec } from './curve-field';
</script>

<script lang="ts">
  /* The curve control: two free handles, one profile for the whole curve, and a
     centre-notched strength fader that IS that profile's curvature. Flat outside
     the handles, so a hold (envelope) or a threshold (transfer curve) needs no
     third handle.

     The fader is BIPOLAR (Trent, 2026-08-17): its notch in the middle is linear,
     up from there bends exponentially, down bends logarithmically — the inverse
     shape — and the mode word beneath it is derived from where the fader sits
     rather than picked separately. Lin / exp / log are therefore one continuum
     with one neutral position, not three buttons of which two could draw the
     same straight line. S-curve rides the same fader, going over centre to
     invert its shoulders; Snap has nothing to bend and greys the fader out.

     Deliberately domain-agnostic — the same control edits an envelope (x = time,
     y = level) and a velocity transfer curve (x = in, y = out). Axis semantics
     are props; the value it publishes is normalised 0..1 in both axes and the
     consumer owns the unit mapping. All the maths lives in `curve-field.ts`
     (pure, unit-tested); this file is the view and the gestures.

     Gesture handling follows the prototype's hard-won fix (proto b2b0328): the
     drag is tracked on `window`, never via setPointerCapture on the handle —
     a re-rendered handle node would drop the capture mid-drag and strand the
     gesture. Nothing is applied until the pointer has moved 2px, so clicking a
     handle selects it without nudging its value.

     One undo per gesture: `onChange` fires continuously (drag, wheel tick, key
     nudge) and `onCommit` fires once at the end of the gesture — pointerup, or
     a short quiet period after the last wheel/key step. */
  import Play from '@lucide/svelte/icons/play';
  import IconButton from './IconButton.svelte';
  import SegmentedControl from './SegmentedControl.svelte';
  import Slider from './Slider.svelte';
  import { wheelStep } from './wheel-step';
  import {
    CURVE_PROFILE_OPTIONS,
    NUDGE,
    NUDGE_COARSE,
    STRENGTH_NOTCH,
    clampBipolar,
    curveModeHint,
    curveModeLabel,
    curvePath,
    dragHandle,
    evalCurve,
    normalizeCurve,
    nudgeHandle,
    plotHits,
    profileHasStrength,
    pxToUnit,
    xToPx,
    yToPx,
    type CurveAxisSpec,
    type CurveBox,
    type CurveHandle,
    type CurveHit,
    type CurveValue,
  } from './curve-field';

  type Props = {
    value: CurveValue;
    /** Every step of a gesture — drag move, wheel tick, key nudge. */
    onChange: (v: CurveValue) => void;
    /** Once per gesture, for the undo stack. Falls back to `onChange` alone. */
    onCommit?: (v: CurveValue) => void;
    xAxis?: CurveAxisSpec;
    yAxis?: CurveAxisSpec;
    /** Recent input events, plotted as fading markers. Presentational only. */
    hits?: readonly CurveHit[];
    /** How long a hit marker takes to fade out. */
    hitFadeMs?: number;
    /** A reference shape drawn behind the curve (e.g. the value's old default). */
    ghost?: (x: number) => number;
    /** Plot height in px; the width is whatever the container gives it. */
    height?: number;
    /** Hide the replay affordance when the surface already animates the value. */
    showPreview?: boolean;
    /** How long one replay sweep takes. */
    previewMs?: number;
    disabled?: boolean;
    ariaLabel?: string;
    class?: string;
  };

  let {
    value,
    onChange,
    onCommit,
    xAxis,
    yAxis,
    hits = [],
    hitFadeMs = 1400,
    ghost,
    height = 120,
    showPreview = true,
    previewMs = 900,
    disabled = false,
    ariaLabel = 'Curve',
    class: klass,
  }: Props = $props();

  const PAD = 12;
  /* Fallback until the container is measured (SSR, and the first frame). */
  const FALLBACK_W = 300;

  let plotWidth = $state(0);
  let svgNode = $state<SVGSVGElement | undefined>();
  let selected = $state<CurveHandle>('h0');
  let dragging = $state<CurveHandle | null>(null);
  let hovered = $state<CurveHandle | null>(null);

  const box = $derived<CurveBox>({
    width: plotWidth > 0 ? plotWidth : FALLBACK_W,
    height,
    pad: PAD,
  });
  const curve = $derived(normalizeCurve(value));
  const paths = $derived(curvePath(curve, box, 96));
  const strengthLive = $derived(profileHasStrength(curve.profile));
  /* The mode word IS the fader position read back — one source of truth, so the
     label can never promise a bend the curve on screen does not have. */
  const modeLabel = $derived(curveModeLabel(curve.profile, curve.strength));
  const modeHint = $derived(curveModeHint(curve.profile, curve.strength));

  const ghostPath = $derived.by(() => {
    if (!ghost) return '';
    let d = '';
    for (let i = 0; i <= 48; i += 1) {
      const x = i / 48;
      d += `${i === 0 ? 'M' : 'L'}${xToPx(x, box).toFixed(2)} ${yToPx(ghost(x), box).toFixed(2)}`;
    }
    return d;
  });

  /* ---- Reduced motion ---------------------------------------------------- */
  let reduced = $state(false);
  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const on = (): void => void (reduced = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  /* ---- Live-input overlay -------------------------------------------------
     A clock the markers read their age from. Under reduced motion it ticks on a
     coarse interval instead of every frame and the markers hold one opacity, so
     they appear and disappear without animating. */
  let clock = $state(0);
  $effect(() => {
    if (hits.length === 0) return;
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    if (reduced) {
      clock = performance.now();
      timer = setInterval(() => (clock = performance.now()), 250);
    } else {
      const frame = (): void => {
        clock = performance.now();
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
    };
  });

  const markers = $derived(plotHits(curve, hits, clock, hitFadeMs));

  /* ---- Replay preview ------------------------------------------------------
     User-triggered, never ambient: one sweep of a playhead across the curve with
     a level meter beside it, so the shape is legible without firing a real hit. */
  let playhead = $state<number | null>(null);
  let playing = $state(false);

  function replay(): void {
    if (playing) return;
    playing = true;
    const started = performance.now();
    const step = (): void => {
      const p = (performance.now() - started) / Math.max(1, previewMs);
      if (p >= 1) {
        playhead = null;
        playing = false;
        return;
      }
      playhead = p;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const meterLevel = $derived(playhead === null ? 0 : evalCurve(curve, playhead));

  /* ---- Commit debounce ----------------------------------------------------
     Wheel ticks and key nudges arrive as a stream; one gesture must land as one
     undo entry, so the commit waits for the stream to go quiet. */
  let commitTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: CurveValue | null = null;

  function apply(next: CurveValue, mode: 'stream' | 'immediate'): void {
    onChange(next);
    if (mode === 'immediate') {
      onCommit?.(next);
      return;
    }
    pending = next;
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      if (pending) onCommit?.(pending);
      pending = null;
    }, 350);
  }

  $effect(() => () => clearTimeout(commitTimer));

  /* ---- Pointer ------------------------------------------------------------ */
  function unitAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgNode?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const px = ((clientX - rect.left) / rect.width) * box.width;
    const py = ((clientY - rect.top) / rect.height) * box.height;
    return pxToUnit(px, py, box);
  }

  function startDrag(handle: CurveHandle, e: PointerEvent): void {
    if (disabled) return;
    e.stopPropagation();
    selected = handle;
    const originX = e.clientX;
    const originY = e.clientY;
    let moved = false;

    const move = (ev: PointerEvent): void => {
      if (!moved) {
        // A click that never travels 2px selects the handle; it must not nudge it.
        if (Math.hypot(ev.clientX - originX, ev.clientY - originY) < 2) return;
        moved = true;
        dragging = handle;
      }
      const at = unitAt(ev.clientX, ev.clientY);
      onChange(dragHandle(value, handle, at.x, at.y));
    };
    const end = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      dragging = null;
      if (!moved) return;
      const at = unitAt(ev.clientX, ev.clientY);
      onCommit?.(dragHandle(value, handle, at.x, at.y));
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** Clicking the plot selects the nearer handle — it never moves a value. */
  function selectNearest(e: PointerEvent): void {
    if (disabled) return;
    const at = unitAt(e.clientX, e.clientY);
    const d0 = Math.hypot(at.x - curve.h0.x, at.y - curve.h0.y);
    const d1 = Math.hypot(at.x - curve.h1.x, at.y - curve.h1.y);
    selected = d0 <= d1 ? 'h0' : 'h1';
  }

  /* ---- Wheel --------------------------------------------------------------
     One step per tick over the plot adjusts the selected handle's level (the
     G3 convention — only the sign of deltaY is read). Attached by hand so the
     listener is non-passive; a passive one can't preventDefault and the panel
     would scroll out from under the gesture. */
  let plotEl = $state<HTMLDivElement | undefined>();

  function onWheel(e: WheelEvent): void {
    if (disabled) return;
    const current = curve[selected].y;
    const next = wheelStep({ value: current, deltaY: e.deltaY, min: 0, max: 1, step: NUDGE });
    if (next === null) return;
    e.preventDefault();
    apply(dragHandle(value, selected, curve[selected].x, Number(next)), 'stream');
  }

  $effect(() => {
    const node = plotEl;
    if (!node) return;
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  });

  /* ---- Keyboard ----------------------------------------------------------- */
  function onHandleKey(handle: CurveHandle, e: KeyboardEvent): void {
    if (disabled) return;
    const step = NUDGE * (e.shiftKey ? NUDGE_COARSE : 1);
    let next: CurveValue | null = null;
    if (e.key === 'ArrowLeft') next = nudgeHandle(value, handle, 'x', -step);
    else if (e.key === 'ArrowRight') next = nudgeHandle(value, handle, 'x', step);
    else if (e.key === 'ArrowUp') next = nudgeHandle(value, handle, 'y', step);
    else if (e.key === 'ArrowDown') next = nudgeHandle(value, handle, 'y', -step);
    if (!next) return;
    e.preventDefault();
    selected = handle;
    apply(next, 'stream');
  }

  /* ---- Readouts ----------------------------------------------------------- */
  const fmtX = $derived(xAxis?.format ?? ((u: number) => `${Math.round(u * 100)}%`));
  const fmtY = $derived(yAxis?.format ?? ((u: number) => `${Math.round(u * 100)}%`));

  function handleLabel(handle: CurveHandle): string {
    const p = curve[handle];
    const role = handle === 'h0' ? 'Start' : 'End';
    return `${role} handle — ${xAxis?.label ?? 'x'} ${fmtX(p.x)}, ${yAxis?.label ?? 'y'} ${fmtY(p.y)}`;
  }

  const profileOptions = CURVE_PROFILE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
</script>

<div class={['curve-field', klass]} class:disabled role="group" aria-label={ariaLabel}>
  <div class="stage">
    <!-- The plot is a plain div so `clientWidth` gives a px-true viewBox: the SVG
         is never stretched (no preserveAspectRatio="none"), which is the only way
         a round handle stays round at any container width. -->
    <div
      class="plot"
      bind:this={plotEl}
      bind:clientWidth={plotWidth}
      style:height={`${height}px`}
    >
      <svg
        bind:this={svgNode}
        viewBox={`0 0 ${box.width} ${box.height}`}
        width={box.width}
        {height}
        onpointerdown={selectNearest}
        aria-hidden="true"
      >
        <!-- floor / mid / ceiling -->
        <line class="axis" x1={xToPx(0, box)} x2={xToPx(1, box)} y1={yToPx(0, box)} y2={yToPx(0, box)} />
        <line class="grid" x1={xToPx(0, box)} x2={xToPx(1, box)} y1={yToPx(0.5, box)} y2={yToPx(0.5, box)} />
        <line class="grid" x1={xToPx(0, box)} x2={xToPx(1, box)} y1={yToPx(1, box)} y2={yToPx(1, box)} />

        {#if ghostPath}
          <path class="ghost" d={ghostPath} />
        {/if}

        <path class="area" d={paths.area} />
        <path class="curve" d={paths.line} />

        {#if playhead !== null}
          <line
            class="playhead"
            x1={xToPx(playhead, box)}
            x2={xToPx(playhead, box)}
            y1={yToPx(1, box)}
            y2={yToPx(0, box)}
          />
          <circle
            class="playdot"
            cx={xToPx(playhead, box)}
            cy={yToPx(evalCurve(curve, playhead), box)}
            r="3.5"
          />
        {/if}

        <!-- Live input. Presentational: never writes, never takes the pointer. -->
        <g class="hits" aria-hidden="true">
          {#each markers as m, i (`${m.at}:${i}`)}
            <circle
              cx={xToPx(m.x, box)}
              cy={yToPx(m.y, box)}
              r={reduced ? 3 : 2.5 + m.fade * 2}
              opacity={reduced ? 0.55 : m.fade}
            />
          {/each}
        </g>

        {#each ['h0', 'h1'] as const as handle (handle)}
          <g
            class="handle"
            class:sel={selected === handle}
            class:live={dragging === handle || hovered === handle}
            role="button"
            tabindex={disabled ? -1 : 0}
            aria-label={handleLabel(handle)}
            onpointerdown={(e) => startDrag(handle, e)}
            onkeydown={(e) => onHandleKey(handle, e)}
            onfocus={() => (selected = handle)}
            onpointerenter={() => (hovered = handle)}
            onpointerleave={() => (hovered = null)}
          >
            <!-- Invisible 13px target: a 5px dot is not a hit area. -->
            <circle
              class="hit"
              cx={xToPx(curve[handle].x, box)}
              cy={yToPx(curve[handle].y, box)}
              r="13"
            />
            <!-- The focus ring, drawn: `outline` doesn't follow an SVG circle. -->
            <circle
              class="ring"
              cx={xToPx(curve[handle].x, box)}
              cy={yToPx(curve[handle].y, box)}
              r="9"
            />
            <circle
              class="dot"
              cx={xToPx(curve[handle].x, box)}
              cy={yToPx(curve[handle].y, box)}
              r="5"
            />
          </g>
        {/each}
      </svg>
    </div>

    <div class="fader" style:height={`${height}px`} title={modeHint}>
      <Slider
        orientation="vertical"
        value={curve.strength}
        min={-1}
        max={1}
        step={0.01}
        notchAt={0}
        notchSnap={STRENGTH_NOTCH}
        showValue={false}
        disabled={disabled || !strengthLive}
        ariaLabel="Curve strength — {modeLabel}"
        onChange={(v) => apply({ ...curve, strength: clampBipolar(v) }, 'stream')}
      />
      <!-- The mode is a readout, not a control: it is what the fader position
           means, printed where the eye already is. -->
      <span class="fader-mode" class:off={!strengthLive}>{strengthLive ? modeLabel : 'Snap'}</span>
      <span class="fader-amount" class:off={!strengthLive}>
        {strengthLive ? Math.abs(curve.strength).toFixed(2) : '—'}
      </span>
    </div>
  </div>

  <div class="controls">
    <SegmentedControl
      value={curve.profile}
      options={profileOptions}
      {disabled}
      ariaLabel="Curve profile"
      onChange={(p) => apply({ ...curve, profile: p as CurveValue['profile'] }, 'immediate')}
      class="profiles"
    />
    {#if showPreview}
      <div class="preview">
        <IconButton
          icon={Play}
          label="Replay the curve"
          size={13}
          disabled={disabled || playing}
          onclick={replay}
        />
        <span class="meter" aria-hidden="true">
          <span class="fill" style:width={`${meterLevel * 100}%`}></span>
        </span>
      </div>
    {/if}
  </div>

  <p class="readout">
    <span class="who">{selected === 'h0' ? 'start' : 'end'}</span>
    <span class="pair"><em>{xAxis?.label ?? 'x'}</em> {fmtX(curve[selected].x)}</span>
    <span class="pair"><em>{yAxis?.label ?? 'y'}</em> {fmtY(curve[selected].y)}</span>
  </p>
</div>

<style>
  .curve-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .curve-field.disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  .stage {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    min-width: 0;
  }
  .plot {
    position: relative;
    flex: 1;
    min-width: 0;
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--border-faint);
    overflow: hidden;
    touch-action: none;
  }
  .plot svg {
    display: block;
  }

  .axis {
    stroke: var(--border);
    stroke-width: 1;
  }
  .grid {
    stroke: var(--border-faint);
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  .ghost {
    fill: none;
    stroke: var(--text-disabled);
    stroke-width: 1.25;
    stroke-dasharray: 3 3;
  }
  .area {
    fill: color-mix(in oklch, var(--accent) 14%, transparent);
    stroke: none;
  }
  .curve {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .playhead {
    stroke: var(--ink);
    stroke-width: 1;
    opacity: 0.35;
  }
  .playdot {
    fill: var(--ink);
  }

  .hits circle {
    fill: var(--role-input);
    pointer-events: none;
  }

  .handle {
    cursor: grab;
    outline: none;
  }
  .handle:active {
    cursor: grabbing;
  }
  .handle .hit {
    fill: transparent;
  }
  .handle .dot {
    fill: var(--surface);
    stroke: var(--ink);
    stroke-width: 2;
    transition: stroke var(--dur-120) ease, fill var(--dur-120) ease;
  }
  .handle.live .dot,
  .handle:focus-visible .dot {
    stroke: var(--accent);
  }
  .handle.sel .dot {
    fill: var(--accent);
    stroke: var(--accent);
  }
  .handle .ring {
    fill: none;
    stroke: var(--accent-ring);
    stroke-width: 2;
    opacity: 0;
  }
  .handle:focus-visible .ring {
    opacity: 1;
  }

  .fader {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    flex: none;
    /* Wide enough for the longest mode word ("Out-in") at --text-2xs, so the
       readout never wraps and the plot never reflows as the fader crosses
       centre. */
    width: 46px;
  }
  /* The fader shares the column with its readout, so it takes the leftover
     height rather than the wrapper's full height (which would push the readout
     out of the box and shift every thumb position with it). */
  .fader :global(.slider) {
    flex: 1;
    min-height: 0;
    height: auto;
  }
  /* Disabled still has to READ as a control — Slider's 0.4 sinks the rail into
     the inset background it sits on, which reads as "gone", not "greyed". */
  .fader :global(.slider.disabled) {
    opacity: 0.55;
  }
  /* Mode first and the magnitude under it: the word is what changed when the
     fader crossed centre, so it carries the weight and the number recedes. */
  .fader-mode {
    font-size: var(--text-2xs);
    line-height: 1.1;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text);
    white-space: nowrap;
  }
  .fader-amount {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }
  .fader-mode.off,
  .fader-amount.off {
    color: var(--text-disabled);
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
  }
  .controls :global(.profiles) {
    min-width: 0;
  }
  .preview {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }
  .meter {
    display: block;
    width: 48px;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--border-faint);
    overflow: hidden;
  }
  .meter .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .readout {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    min-width: 0;
  }
  .readout .who {
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  .readout .pair {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    white-space: nowrap;
  }
  .readout .pair em {
    font-family: var(--font-sans);
    font-style: normal;
    color: var(--text-faint);
  }

  @media (prefers-reduced-motion: reduce) {
    .handle .dot {
      transition: none;
    }
  }
</style>
