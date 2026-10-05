<script lang="ts">
  /* A hoop's pixels as a ring to click (Tim, 2026-10-05: "i should have an option for which pixel /
     area on the hoop i am starting from"). Pixel 1 sits at the top and they run clockwise; the
     chosen one is lit. A press or a drag picks the nearest pixel by angle. The number field beside
     it is the keyboard route, so the ring itself is a pointer aid. Every drag is one undo step. */
  let {
    count,
    value,
    disabled = false,
    onChange,
    onGestureStart,
    onGestureEnd,
  }: {
    /** Pixels on the hoop. */
    count: number;
    /** The chosen pixel, 1-based. */
    value: number;
    disabled?: boolean;
    onChange: (pixel: number) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
  } = $props();

  const n = $derived(Math.max(1, Math.round(count)));
  const chosen = $derived(Math.min(n, Math.max(1, Math.round(value))));
  const R = 40;
  // Dots shrink as the hoop gets denser, so neighbours never touch.
  const dotR = $derived(Math.max(0.9, Math.min(3, (Math.PI * R) / n / 1.4)));
  const at = (i: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a) };
  };
  const dots = $derived(Array.from({ length: n }, (_, i) => at(i)));
  const mark = $derived(at(chosen - 1));

  let dragging = false;
  function pick(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const dx = event.clientX - (box.left + box.width / 2);
    const dy = event.clientY - (box.top + box.height / 2);
    // Angle clockwise from the top, 0..1 of the way round.
    const turn = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1;
    const pixel = (Math.round(turn * n) % n) + 1;
    if (pixel !== chosen) onChange(pixel);
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
  <circle class="on" cx={mark.x} cy={mark.y} r={Math.max(3.2, dotR * 1.8)} />
  <text class="num" x="50" y="50">{chosen}</text>
  <text class="of" x="50" y="62">of {n}</text>
</svg>

<style>
  .ring {
    display: block;
    width: 88px;
    height: 88px;
    flex: none;
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
  .of {
    fill: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 8px;
    text-anchor: middle;
    dominant-baseline: middle;
  }
</style>
