<script lang="ts">
  /* The compact in-place param control that rides a node-face row (S5).

     A node card is 176–260px wide, so this is NOT a slider: a number is a drag/wheel field
     that shows only its value, an enum is a cycle chip, a bool is a small switch. All three
     are one control height (16px) so a row of any type stays 22px and the card stays legible
     at graph zoom.

     Interaction contract (locked, memory `graph-interaction-prefs`): no lift, no click
     animation — colour/border state changes are instant. The wrapper carries xyflow's
     `nodrag nopan nowheel` so dragging the value never drags the NODE and a wheel tick never
     zooms the canvas.

     Undo: a drag publishes on every pointermove, so the caller wraps it in one gesture —
     `onGestureStart` fires once at pointer-down, `onGestureEnd` once at pointer-up/cancel
     (and on destroy, so a pointer lost to a canvas re-render can't leave undo suppressed).
     A wheel tick is its own single-value gesture, so it needs no bracket.

     `modulated` reflects the ColorSwatch precedent: a driven param still shows and edits its
     BASE value — the wire animates around it — with a badge so a static-looking number is
     never mistaken for the whole story. */
  import { wheelStep } from './wheel-step';
  import { dragNumber } from './drag-number';
  import Spline from '@lucide/svelte/icons/spline';

  interface Props {
    kind: 'number' | 'bool' | 'enum' | 'color';
    /** Current value (the node's own, or the spec default). */
    value: number | string | boolean;
    /** Pre-formatted read-out for number/enum (the caller owns units + precision). */
    display: string;
    min?: number;
    max?: number;
    step?: number;
    /** Enum choices, in declaration order — the cycle chip walks them. */
    options?: string[];
    /** True when a modulation source is wired into this param: badge it, keep it editable. */
    modulated?: boolean;
    disabled?: boolean;
    ariaLabel: string;
    onChange: (v: number | string | boolean) => void;
    /** Opens a continuous-edit gesture (one undo for the whole drag). */
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
  }

  let {
    kind,
    value,
    display,
    min,
    max,
    step,
    options = [],
    modulated = false,
    disabled = false,
    ariaLabel,
    onChange,
    onGestureStart,
    onGestureEnd,
  }: Props = $props();

  const numeric = $derived(typeof value === 'number' && Number.isFinite(value) ? value : min ?? 0);

  // --- number: drag + wheel + keyboard -------------------------------------
  let dragging = $state(false);
  let anchorX = 0;
  let anchorValue = 0;

  /** Close the open gesture exactly once, whatever ended it (up / cancel / destroy). */
  function closeGesture(): void {
    if (!dragging) return;
    dragging = false;
    onGestureEnd?.();
  }

  function onPointerDown(e: PointerEvent): void {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    anchorX = e.clientX;
    anchorValue = numeric;
    dragging = true;
    onGestureStart?.();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const next = dragNumber({
      start: anchorValue,
      dx: e.clientX - anchorX,
      min,
      max,
      step,
      fine: e.shiftKey,
    });
    if (next !== numeric) onChange(next);
  }

  function onWheel(e: WheelEvent): void {
    if (disabled) return;
    const next = wheelStep({ value: numeric, deltaY: e.deltaY, min, max, step });
    if (next === null) return;
    e.preventDefault();
    onChange(Number(next));
  }

  /** Arrow keys nudge one step — the field is a real control, so it must work without a
      pointer. Each press is its own value, so no gesture bracket is needed. */
  function onKeyDown(e: KeyboardEvent): void {
    if (disabled) return;
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = dragNumber({
      start: numeric,
      dx: dir * (step && step > 0 && min !== undefined && max !== undefined ? 220 / ((max - min) / step) : 4),
      min,
      max,
      step,
    });
    if (next !== numeric) onChange(next);
  }

  // --- enum: cycle chip ----------------------------------------------------
  function cycle(dir: 1 | -1): void {
    if (disabled || options.length < 2) return;
    const at = options.indexOf(String(value));
    const from = at === -1 ? 0 : at;
    onChange(options[(from + dir + options.length) % options.length]!);
  }

  // A pointer lost mid-drag (canvas re-render, node re-key) must not strand the gesture and
  // leave every later edit folded into it.
  $effect(() => () => closeGesture());
</script>

<span class={['facectl', 'nodrag', 'nopan', 'nowheel']} class:disabled class:modulated>
  {#if kind === 'bool'}
    <button
      type="button"
      class="sw"
      class:on={value === true}
      role="switch"
      aria-checked={value === true}
      aria-label={ariaLabel}
      {disabled}
      onclick={(e) => {
        e.stopPropagation();
        onChange(value !== true);
      }}
    >
      <span class="knob"></span>
    </button>
  {:else if kind === 'enum'}
    <button
      type="button"
      class="chip"
      aria-label={`${ariaLabel}: ${display}. Click to cycle.`}
      title={`${display} — click to cycle`}
      {disabled}
      onclick={(e) => {
        e.stopPropagation();
        cycle(e.shiftKey ? -1 : 1);
      }}
      onkeydown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          cycle(1);
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          cycle(-1);
        }
      }}
    >
      <span class="chiptext">{display}</span>
    </button>
  {:else}
    <!-- number (and `color`, which no effect declares yet — it falls through to the numeric
         field rather than rendering nothing, so a future colour param is still legible). -->
    <span
      class="num"
      class:dragging
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuenow={numeric}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={display}
      aria-disabled={disabled}
      title={`${display} — drag or scroll to adjust`}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={closeGesture}
      onpointercancel={closeGesture}
      onlostpointercapture={closeGesture}
      onwheel={onWheel}
      onkeydown={onKeyDown}
    >
      {display}
    </span>
  {/if}
  {#if modulated}
    <span class="modbadge" title="Driven by a modulation wire — this is the base value">
      <Spline size={8} aria-hidden="true" />
    </span>
  {/if}
</span>

<style>
  .facectl {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
    line-height: 0;
  }
  .facectl.disabled {
    opacity: 0.45;
    pointer-events: none;
  }

  /* numeric drag field — value only, no rail: at 176px of card there is no room for one,
     and the drag IS the affordance (cursor + hover border say so). */
  .num {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 40px;
    max-width: 72px;
    height: 16px;
    padding: 0 4px;
    border-radius: var(--radius-1);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border-faint);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    cursor: ew-resize;
    user-select: none;
    touch-action: none;
  }
  /* instant, no transition — the locked node interaction contract */
  .num:hover {
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .num:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 2px var(--accent-soft);
  }
  .num.dragging {
    box-shadow: inset 0 0 0 1px var(--accent);
    color: var(--ink);
  }

  /* enum cycle chip */
  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 76px;
    height: 16px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border-faint);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: 16px;
    cursor: pointer;
  }
  .chip:hover {
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .chip:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 2px var(--accent-soft);
  }
  .chiptext {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* bool switch — the smallest thing that still reads as a switch at graph zoom */
  .sw {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 26px;
    height: 14px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border-faint);
    cursor: pointer;
  }
  .sw:hover {
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .sw:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 2px var(--accent-soft);
  }
  .sw.on {
    background: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .knob {
    position: absolute;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .sw.on .knob {
    left: 14px;
    background: var(--on-accent);
  }

  /* modulation badge — the ColorSwatch precedent: the value stays editable, the badge says
     the live output is swept around it. */
  .modbadge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--role-modulation);
    line-height: 0;
  }
</style>
