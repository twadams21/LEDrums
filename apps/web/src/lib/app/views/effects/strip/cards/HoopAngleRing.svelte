<script lang="ts">
  /* The Start angle as the hoop itself, seen from the throne (Tim, 2026-10-05: "the start angle ring
     needs to imitate the actual drum ring in real life. don't worry about degrees. the bottom of the
     ring should be the closest point to the player … the right most point of the ring … the right
     most point of the corresponding drum's hoop"). One dot per pixel; the chosen one lit. A press or
     a drag picks the nearest pixel; focused, the arrow keys step a pixel round (→ / ↑ towards the
     right side first). It stores degrees from the front — the effect's angle — but shows none. Every
     drag is one undo step. */
  let {
    count,
    value,
    disabled = false,
    ariaLabel,
    onChange,
    onGestureStart,
    onGestureEnd,
  }: {
    /** Pixels on the hoop — the ring's dots, one step of 360° / count apart. */
    count: number;
    /** The angle, degrees from the front. */
    value: number;
    disabled?: boolean;
    ariaLabel: string;
    onChange: (degrees: number) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
  } = $props();

  const n = $derived(Math.max(1, Math.round(count)));
  const step = $derived(360 / n);
  const R = 40;
  // Dots shrink as the hoop gets denser, so neighbours never touch.
  const dotR = $derived(Math.max(0.9, Math.min(3, (Math.PI * R) / n / 1.4)));
  /** A point on the ring `deg` from the bottom, turning towards the right. */
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: 50 + R * Math.sin(a), y: 50 + R * Math.cos(a) };
  };
  const dots = $derived(Array.from({ length: n }, (_, i) => at(i * step)));
  const shown = $derived(((Math.round(value / step) % n) + n) % n);
  const mark = $derived(at(shown * step));
  const at360 = (deg: number) => Math.round(((deg % 360) + 360) % 360);
  /** Where the chosen pixel sits, in words — the ring's accessible value. */
  const where = $derived.by(() => {
    const k = shown;
    if (k === 0) return 'the front';
    const half = n / 2;
    const side = k < half ? 'right' : 'left';
    const steps = k < half ? k : n - k;
    return k === half ? 'the back' : `${steps} pixel${steps === 1 ? '' : 's'} round to the ${side}`;
  });

  function key(event: KeyboardEvent): void {
    if (disabled) return;
    const by = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (!by) return;
    event.preventDefault();
    onChange(at360((shown + by) * step));
  }

  let dragging = false;
  function pick(event: PointerEvent): void {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    // Degrees from the bottom, towards the right — snapped to a pixel.
    const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const snapped = Math.round(((Math.round(deg / step) % n) * step) % 360);
    if (snapped !== Math.round(value)) onChange(snapped);
  }
  function down(event: PointerEvent): void {
    if (disabled || event.button !== 0) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragging = true;
    onGestureStart?.();
    pick(event);
  }
  function move(event: PointerEvent): void {
    if (dragging) pick(event);
  }
  function up(): void {
    if (!dragging) return;
    dragging = false;
    onGestureEnd?.();
  }
</script>

<svg
  class="ring"
  class:disabled
  viewBox="0 0 100 100"
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={ariaLabel}
  aria-valuemin={0}
  aria-valuemax={n - 1}
  aria-valuenow={shown}
  aria-valuetext={where}
  onkeydown={key}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  <circle class="track" cx="50" cy="50" r={R} />
  {#each dots as d, i (i)}
    <circle class="px" cx={d.x} cy={d.y} r={dotR} />
  {/each}
  <!-- The hoop as the drummer sees it: the front (their side) at the bottom, its right on the right. -->
  <text class="edge" x="50" y="99">front</text>
  <text class="edge side" x="2" y="51">L</text>
  <text class="edge side" x="98" y="51">R</text>
  <circle class="on" cx={mark.x} cy={mark.y} r={Math.max(3.2, dotR * 1.8)} />
</svg>

<style>
  .ring {
    display: block;
    width: 88px;
    height: 88px;
    flex: none;
    overflow: visible;
    cursor: pointer;
    touch-action: none;
  }
  .ring.disabled {
    cursor: default;
    opacity: 0.5;
  }
  .track {
    fill: none;
    stroke: var(--border-faint);
    stroke-width: 1;
  }
  .px {
    fill: var(--text-faint);
    opacity: 0.55;
  }
  .on {
    fill: var(--accent);
    stroke: var(--surface-inset);
    stroke-width: 1.5;
  }
  .ring:focus-visible {
    outline: none;
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--accent-soft), inset 0 0 0 1px var(--accent);
  }
  .edge {
    fill: var(--text-faint);
    font-size: 7px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-anchor: middle;
  }
  .edge.side {
    dominant-baseline: middle;
  }
</style>
