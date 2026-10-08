<script lang="ts">
  /* A point in the kit's space, picked on two views of the kit (Tim, 2026-10-05: "can you make a
     little graphic for the X, Y and Z starting point … refer to height, width and depth", then "put
     the drums as we see them in the visualiser"). Top sets width and depth, Front width and height —
     each the visualiser's camera of that name: x to the right, Top with the drummer's side at the
     top, Front with up up. Every drum is drawn as its hoops, from the pixel positions. Click or drag
     in a view; with a view focused, the arrows move the point (Shift: finer). A drag is one undo
     step. */
  import type { KitPlan } from '../strip-model';

  type Point = { width: number; depth: number; height: number };
  let {
    plan,
    value,
    disabled = false,
    onChange,
    onGestureStart,
    onGestureEnd,
  }: {
    /** The kit in plan, or null when the host can't say (the views then show the bounds only). */
    plan: KitPlan | null;
    /** The point as 0..1 across the kit's width (x), depth (y) and height (z). */
    value: Point;
    disabled?: boolean;
    onChange: (next: Partial<Point>) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
  } = $props();

  const W = 104;
  const bounds = $derived(plan?.bounds ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
  const span = (a: 'x' | 'y' | 'z') => Math.max(1e-6, bounds.max[a] - bounds.min[a]);
  // Each view keeps the kit's proportions, its height clamped so a flat kit still has room.
  const hAbove = $derived(Math.round(Math.min(96, Math.max(44, (W * span('y')) / span('x')))));
  const hFront = $derived(Math.round(Math.min(96, Math.max(44, (W * span('z')) / span('x')))));
  const nx = (v: number, a: 'x' | 'y' | 'z') => (v - bounds.min[a]) / span(a);

  type View = 'above' | 'front';
  const vAxis = (view: View) => (view === 'above' ? 'y' : 'z');
  const vKey = (view: View): keyof Point => (view === 'above' ? 'depth' : 'height');

  /** Down the view, 0..1 for a value 0..1: Top has the drummer's side (low y) at the top; Front
      has height going up. */
  const alongDown = (view: View, v: number) => (view === 'above' ? v : 1 - v);

  /** Each drum's hoops as closed paths, in a view's pixels. */
  function shapes(view: View, h: number) {
    const a = vAxis(view);
    return (plan?.drums ?? []).map((d) => ({
      id: d.id,
      label: d.label,
      path: d.hoops
        .map((ring) => ring.map((pt, i) => `${i ? 'L' : 'M'}${(nx(pt.x, 'x') * W).toFixed(1)} ${(alongDown(view, nx(pt[a], a)) * h).toFixed(1)}`).join(' ') + ' Z')
        .join(' '),
    }));
  }
  const aboveShapes = $derived(shapes('above', hAbove));
  const frontShapes = $derived(shapes('front', hFront));

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const clamp = (v: number) => Math.min(1, Math.max(0, Number(v.toFixed(3))));

  let dragging: View | null = null;
  function pick(view: View, event: PointerEvent): void {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const width = clamp((event.clientX - box.left) / box.width);
    const other = clamp(alongDown(view, (event.clientY - box.top) / box.height));
    onChange({ width, [vKey(view)]: other });
  }
  function down(view: View, event: PointerEvent): void {
    if (disabled || event.button !== 0) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragging = view;
    onGestureStart?.();
    pick(view, event);
  }
  function move(view: View, event: PointerEvent): void {
    if (dragging === view) pick(view, event);
  }
  function up(): void {
    if (!dragging) return;
    dragging = null;
    onGestureEnd?.();
  }
  function key(view: View, event: KeyboardEvent): void {
    if (disabled) return;
    const step = event.shiftKey ? 0.01 : 0.05;
    const v = vKey(view);
    const moves: Record<string, Partial<Point>> = {
      ArrowLeft: { width: clamp(value.width - step) },
      ArrowRight: { width: clamp(value.width + step) },
      // Up the picture: Front raises the height; Top moves towards the drummer (less depth).
      ArrowUp: { [v]: clamp(value[v] + (view === 'above' ? -step : step)) },
      ArrowDown: { [v]: clamp(value[v] - (view === 'above' ? -step : step)) },
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    onChange(next);
  }
</script>

{#snippet view(name: View, h: number, list: ReturnType<typeof shapes>, caption: string, vName: string)}
  {@const px = value.width * W}
  {@const py = alongDown(name, value[vKey(name)]) * h}
  <figure class="view">
    <svg
      viewBox={`0 0 ${W} ${h}`}
      width={W}
      height={h}
      class:disabled
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-label={`Start point ${caption.toLowerCase()}`}
      aria-valuetext={`Width ${pct(value.width)}, ${vName} ${pct(value[vKey(name)])}`}
      aria-valuenow={Math.round(value.width * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onpointerdown={(e) => down(name, e)}
      onpointermove={(e) => move(name, e)}
      onpointerup={up}
      onpointercancel={up}
      onkeydown={(e) => key(name, e)}
    >
      <rect class="box" x="0.5" y="0.5" width={W - 1} height={h - 1} rx="3" />
      {#each list as d (d.id)}
        <path class="drum" d={d.path}><title>{d.label}</title></path>
      {/each}
      <line class="cross" x1={px} y1="0" x2={px} y2={h} />
      <line class="cross" x1="0" y1={py} x2={W} y2={py} />
      <circle class="pt" cx={px} cy={py} r="4" />
    </svg>
    <figcaption>{caption}</figcaption>
  </figure>
{/snippet}

<div class="picker">
  <div class="views">
    {@render view('above', hAbove, aboveShapes, 'Top', 'Depth')}
    {@render view('front', hFront, frontShapes, 'Front', 'Height')}
  </div>
  <p class="read">Width {pct(value.width)} · Depth {pct(value.depth)} · Height {pct(value.height)}</p>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .views {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .view {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
  }
  svg {
    display: block;
    border-radius: var(--radius-1);
    background: var(--surface-inset);
    cursor: crosshair;
    touch-action: none;
  }
  svg.disabled {
    cursor: default;
    opacity: 0.5;
  }
  svg:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-soft), inset 0 0 0 1px var(--accent);
  }
  .box {
    fill: none;
    stroke: var(--border-faint);
  }
  .drum {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 0.9;
    stroke-linejoin: round;
  }
  .cross {
    stroke: color-mix(in oklch, var(--accent) 45%, transparent);
    stroke-width: 0.75;
    stroke-dasharray: 2 2;
  }
  .pt {
    fill: var(--accent);
    stroke: var(--surface-inset);
    stroke-width: 1.5;
  }
  figcaption,
  .read {
    margin: 0;
    color: var(--text-faint);
    font-size: 0.6875rem;
  }
  .read {
    font-family: var(--font-mono);
  }
</style>
