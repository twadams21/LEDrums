<script lang="ts">
  /* The compact in-place param control that rides a card param row (S5).

     A device card is narrow, so a number rides a COMPACT slider — a 48px rail plus its
     value field — rather than the full-width Slider; an enum is a cycle chip, a bool
     is a small switch. All are one control height (16px) so a row of any type stays 22px and
     a card of mixed rows keeps one rhythm.

     The number has two gestures, deliberately: the rail is ABSOLUTE (press jumps to where you
     pressed, the slider contract every DAW shares), the value field is RELATIVE (grab and
     sweep, `ew-resize`). A param with no declared range has no rail — there is no position to
     map — so it falls back to the field alone.

     Interaction contract (locked, memory `graph-interaction-prefs`): no lift, no click
     animation — colour/border state changes are instant.

     Undo: a drag publishes on every pointermove, so the caller wraps it in one gesture —
     `onGestureStart` fires once at pointer-down, `onGestureEnd` once at pointer-up/cancel
     (and on destroy, so a pointer lost to a re-render can't leave undo suppressed).
     A wheel tick is its own single-value gesture, so it needs no bracket.

     Exact values (Tim, 2026-10-02: "i can't type in a number into any of the boxes"): a CLICK on
     the value field (a press that does not move) opens it for typing — Enter commits, Esc or
     clicking away cancels; Enter on the focused field does the same. `entry` says what the box
     shows and reads (a 0..1 percent typed as 25; `1.5s` into a ms param; `1/8` into a beats one).
     Fine adjustment: hold Shift while dragging — the number OR the rail (Shift turns the rail's
     drag relative, so it creeps from where it is instead of jumping to the pointer) — for a
     quarter of the speed. Arrows step (Shift: ten steps), on the focused field and, Up / Down, in
     the typed box too. Pressing the rail focuses the field, so the arrows work straight after.
     The rail fills the row's spare width (48px at the least), so a drag has room for accuracy.

     `modulated` reflects the ColorSwatch precedent: a driven param still shows and edits its
     BASE value — the modulation moves the live output around it — with a badge so a
     static-looking number is never mistaken for the whole story. */
  import { wheelAdjusts, wheelStep } from './wheel-step';
  import { dragNumber, railValue, railFraction } from './drag-number';
  import { clampEntry, entryText, parseEntry, type EntryScale } from './number-entry';
  import { tick } from 'svelte';
  import Spline from '@lucide/svelte/icons/spline';

  interface Props {
    kind: 'number' | 'bool' | 'enum' | 'color';
    /** Current value (the device's own, or the spec default). */
    value: number | string | boolean;
    /** Pre-formatted read-out for number/enum (the caller owns units + precision). */
    display: string;
    min?: number;
    max?: number;
    step?: number;
    /** Enum choices, in declaration order — the cycle chip walks them. */
    options?: string[];
    /** True when a Control or modulator drives this param: badge it, keep it editable. */
    modulated?: boolean;
    disabled?: boolean;
    ariaLabel: string;
    onChange: (v: number | string | boolean) => void;
    /** Opens a continuous-edit gesture (one undo for the whole drag). */
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
    /** What the typed box shows and reads: a display factor (100 for a 0..1 percent) and unit. */
    entry?: EntryScale;
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
    entry,
  }: Props = $props();

  const numeric = $derived(typeof value === 'number' && Number.isFinite(value) ? value : min ?? 0);

  // --- number: rail + drag + wheel + keyboard ------------------------------
  /** A rail needs a range to map a position onto; an open-ended param gets the field alone. */
  const ranged = $derived(min !== undefined && max !== undefined && max > min);
  const fillPct = $derived(ranged ? railFraction(numeric, min!, max!) * 100 : 0);

  let dragging = $state(false);
  let anchorX = 0;
  let anchorValue = 0;
  /** Whether this press has moved far enough to be a drag (else, on release, it is a click). */
  let moved = false;
  const CLICK_SLOP_PX = 3;

  // --- number: typing an exact value ----------------------------------------------------------
  let editing = $state(false);
  let draft = $state('');
  let inputEl = $state<HTMLInputElement>();

  async function startEdit(): Promise<void> {
    if (disabled) return;
    draft = entryText(numeric, entry);
    editing = true;
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }
  function commitEdit(): void {
    if (!editing) return;
    editing = false;
    const parsed = parseEntry(draft, entry);
    if (parsed === null) return; // not a number: leave the value as it was
    const next = clampEntry(parsed, min, max, step);
    if (next !== numeric) onChange(next);
  }
  function cancelEdit(): void {
    editing = false;
  }
  /** One arrow press: the declared step, else 1 on a wide range (Hue's 0–360) or a hundredth of
      a narrow one (a 0–1 amount) — never a jump of a sixth of the range. */
  function keyStep(): number {
    if (step && step > 0) return step;
    if (min !== undefined && max !== undefined && max > min) return max - min >= 100 ? 1 : (max - min) / 100;
    return 1;
  }
  /** Step the value in the typed box, so the arrows work while typing too. */
  function stepDraft(dir: 1 | -1, n: number): void {
    const current = parseEntry(draft, entry) ?? numeric;
    draft = entryText(clampEntry(current + dir * n * keyStep(), min, max, step), entry);
  }
  let railEl = $state<HTMLElement>();
  let numEl = $state<HTMLElement>();
  /** Rail drag state: once Shift is used in a gesture the drag stays RELATIVE (no jump back to
      the pointer), accumulating an unsnapped value so a fine creep is never rounded away. */
  let railRelative = false;
  let railLastX = 0;
  let railRaw = 0;
  const FINE = 0.25;

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
    moved = false;
    dragging = true;
    onGestureStart?.();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    if (!moved && Math.abs(e.clientX - anchorX) < CLICK_SLOP_PX) return;
    moved = true;
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

  // --- number: the rail (absolute — press jumps, drag tracks) --------------
  function railAt(clientX: number): number | null {
    if (!ranged || !railEl) return null;
    const r = railEl.getBoundingClientRect();
    if (r.width <= 0) return null;
    return railValue({ fraction: (clientX - r.left) / r.width, min: min!, max: max!, step });
  }

  function onRailDown(e: PointerEvent): void {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    onGestureStart?.();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // The arrows work straight after touching the slider.
    numEl?.focus({ preventScroll: true });
    railRelative = e.shiftKey;
    railLastX = e.clientX;
    railRaw = numeric;
    if (railRelative) return; // a Shift-press creeps from here; it never jumps
    const next = railAt(e.clientX);
    if (next !== null && next !== numeric) onChange(next);
    if (next !== null) railRaw = next;
  }

  function onRailMove(e: PointerEvent): void {
    if (!dragging) return;
    if (e.shiftKey) railRelative = true;
    if (railRelative && ranged && railEl) {
      const width = railEl.getBoundingClientRect().width;
      if (width <= 0) return;
      const span = max! - min!;
      railRaw = Math.min(max!, Math.max(min!, railRaw + ((e.clientX - railLastX) / width) * span * (e.shiftKey ? FINE : 1)));
      railLastX = e.clientX;
      const next = railValue({ fraction: (railRaw - min!) / span, min: min!, max: max!, step });
      if (next !== numeric) onChange(next);
      return;
    }
    railLastX = e.clientX;
    const next = railAt(e.clientX);
    if (next !== null) {
      railRaw = next;
      if (next !== numeric) onChange(next);
    }
  }

  function onWheel(e: WheelEvent): void {
    // Plain scroll never edits a node-face param; ⌥-scroll does (see `wheelAdjusts`).
    if (disabled || !wheelAdjusts(e)) return;
    const next = wheelStep({ value: numeric, deltaY: e.deltaY, min, max, step });
    if (next === null) return;
    e.preventDefault();
    onChange(Number(next));
  }

  /** A press on the field that did not move is a click: open the field for typing. */
  function onFieldUp(): void {
    const click = dragging && !moved;
    closeGesture();
    if (click) void startEdit();
  }

  /** Arrow keys nudge one step (Shift: ten) — the field is a real control, so it must work
      without a pointer; Enter opens it for typing. Each press is its own value, so no gesture
      bracket is needed. */
  function onKeyDown(e: KeyboardEvent): void {
    if (disabled) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      void startEdit();
      return;
    }
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const n = e.shiftKey ? 10 : 1;
    const next = clampEntry(numeric + dir * n * keyStep(), min, max, step);
    if (next !== numeric) onChange(next);
  }

  // --- enum: cycle chip ----------------------------------------------------
  function cycle(dir: 1 | -1): void {
    if (disabled || options.length < 2) return;
    const at = options.indexOf(String(value));
    const from = at === -1 ? 0 : at;
    onChange(options[(from + dir + options.length) % options.length]!);
  }

  // A pointer lost mid-drag (a re-render, a row re-key) must not strand the gesture and
  // leave every later edit folded into it.
  $effect(() => () => closeGesture());
</script>

<span class="facectl" class:disabled class:modulated>
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
    {#if ranged}
      <!-- The rail is the affordance the full Slider carries, shrunk to card width. It
           is decoration for assistive tech — the `.num` field below is the labelled
           role="slider", so a screen reader gets ONE control, not two for the same value. -->
      <span
        class="rail"
        class:dragging
        bind:this={railEl}
        aria-hidden="true"
        title="Drag to set · hold Shift for fine"
        onpointerdown={onRailDown}
        onpointermove={onRailMove}
        onpointerup={closeGesture}
        onpointercancel={closeGesture}
        onlostpointercapture={closeGesture}
        onwheel={onWheel}
      >
        <span class="fill" style={`width:${fillPct}%`}></span>
        <span class="thumb" style={`left:${fillPct}%`}></span>
      </span>
    {/if}
    {#if editing}
      <!-- Typing an exact value. Every key stays in the box (it is a text input, so the app's
           drum / shortcut keys pass it by); Enter commits, Esc or leaving the box cancels. -->
      <input
        class="numin"
        type="text"
        inputmode="decimal"
        bind:this={inputEl}
        bind:value={draft}
        aria-label={`${ariaLabel} value`}
        onkeydown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commitEdit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // Up / Down step the typed value (Shift: ten); Left / Right stay the text cursor's.
            e.preventDefault();
            stepDraft(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
          }
        }}
        onblur={commitEdit}
        onpointerdown={(e) => e.stopPropagation()}
      />
    {:else}
    <span
      class="num"
      class:dragging
      bind:this={numEl}
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuenow={numeric}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={display}
      aria-disabled={disabled}
      title={`${display} — click to type · drag to adjust · hold Shift while dragging for fine · arrows step (Shift: ×10)`}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onFieldUp}
      onpointercancel={closeGesture}
      onlostpointercapture={closeGesture}
      onwheel={onWheel}
      onkeydown={onKeyDown}
    >
      {display}
    </span>
    {/if}
  {/if}
  {#if modulated}
    <span class="modbadge" title="Modulated — this is the base value">
      <Spline size={8} aria-hidden="true" />
    </span>
  {/if}
</span>

<style>
  .facectl {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    flex: 1 1 auto;
    min-width: 0;
    line-height: 0;
  }
  .facectl.disabled {
    opacity: 0.45;
    pointer-events: none;
  }

  /* the rail takes the row's spare width — more travel, more accuracy (Tim, 2026-10-02) — but
     never less than 48px, the smallest span that still reads as a slider, nor more than 160px. */
  .rail {
    position: relative;
    display: inline-block;
    min-width: 48px;
    max-width: 160px;
    height: 16px;
    flex: 1 1 48px;
    cursor: pointer;
    touch-action: none;
  }
  .rail::before {
    content: '';
    position: absolute;
    inset: 0;
    top: 50%;
    height: 4px;
    transform: translateY(-50%);
    border-radius: var(--radius-pill);
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--border-faint);
  }
  .fill {
    position: absolute;
    left: 0;
    top: 50%;
    height: 4px;
    transform: translateY(-50%);
    border-radius: var(--radius-pill);
    background: var(--accent);
  }
  .thumb {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    margin-left: -4px;
    border-radius: 50%;
    background: var(--ink);
    transform: translateY(-50%);
  }
  /* instant, no transition — the locked interaction contract */
  .rail:hover::before {
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .rail.dragging .thumb {
    background: var(--accent);
  }

  /* numeric field — the readout, and a relative drag/wheel target in its own right */
  .num {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 38px;
    max-width: 62px;
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
  /* instant, no transition — the locked interaction contract */
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

  /* the typed box: the field's size and type, an accent edge while it has the keyboard */
  .numin {
    width: 62px;
    height: 16px;
    padding: 0 4px;
    border: 0;
    border-radius: var(--radius-1);
    background: var(--surface-inset);
    box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 2px var(--accent-soft);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    text-align: right;
    outline: none;
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

  /* bool switch — the smallest thing that still reads as a switch */
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
