<script lang="ts">
  /* The Start angle as a ring of the hoop's pixels, seen from the throne (Tim, 2026-10-05: "it
     should be in degrees. the bottom of the ring should be 0 degrees and … correlate to the front of
     the drum — the closest point to the drummer's playing position"). 0° at the bottom, 90° to the
     right (the drummer's right), 180° at the top. A press or a drag picks the angle of the nearest
     pixel; the number field beside it is the keyboard route, so the ring is a pointer aid. Every
     drag is one undo step. */
  let {
    count,
    value,
    disabled = false,
    onChange,
    onGestureStart,
    onGestureEnd,
  }: {
    /** Pixels on the hoop — the ring's dots, one step of 360° / count apart. */
    count: number;
    /** The angle, degrees from the front. */
    value: number;
    disabled?: boolean;
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
  const label = $derived(Math.round(((value % 360) + 360) % 360));

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
  aria-hidden="true"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  <circle class="track" cx="50" cy="50" r={R} />
  {#each dots as d, i (i)}
    <circle class="px" cx={d.x} cy={d.y} r={dotR} />
  {/each}
  <!-- The front of the drum: the drummer's side. -->
  <text class="front" x="50" y="99">front</text>
  <circle class="on" cx={mark.x} cy={mark.y} r={Math.max(3.2, dotR * 1.8)} />
  <text class="num" x="50" y="50">{label}°</text>
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
  .num {
    fill: var(--ink);
    font-family: var(--font-mono);
    font-size: 14px;
    text-anchor: middle;
    dominant-baseline: middle;
  }
  .front {
    fill: var(--text-faint);
    font-size: 7px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-anchor: middle;
  }
</style>
