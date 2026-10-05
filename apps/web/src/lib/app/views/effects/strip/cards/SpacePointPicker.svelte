<script lang="ts">
  /* A point in the kit's space, picked on two views of the kit (Tim, 2026-10-05: "can you make a
     little graphic for the X, Y and Z starting point, so it shows where exactly in space the starting
     point is? having it as a percentage doesn't work … refer to height, width and depth"). From
     above sets width and depth; from the front, width and height. Each drum is drawn as the box round
     its pixels, so the point reads against the real kit. Click or drag in a view; with a view
     focused, the arrows move the point (Shift: finer). Every drag is one undo step. */
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

  /** Each drum as an ellipse over the box round its pixels, in a view's 0..1 coordinates. */
  function shapes(view: View) {
    const a = vAxis(view);
    return (plan?.drums ?? []).map((d) => {
      const x0 = nx(d.min.x, 'x');
      const x1 = nx(d.max.x, 'x');
      const y0 = nx(d.min[a], a);
      const y1 = nx(d.max[a], a);
      return { id: d.id, label: d.label, cx: (x0 + x1) / 2, cy: 1 - (y0 + y1) / 2, rx: Math.max(0.02, (x1 - x0) / 2), ry: Math.max(0.02, (y1 - y0) / 2) };
    });
  }
  const aboveShapes = $derived(shapes('above'));
  const frontShapes = $derived(shapes('front'));

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const clamp = (v: number) => Math.min(1, Math.max(0, Number(v.toFixed(3))));

  let dragging: View | null = null;
  function pick(view: View, event: PointerEvent): void {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const width = clamp((event.clientX - box.left) / box.width);
    const up = clamp(1 - (event.clientY - box.top) / box.height);
    onChange({ width, [vKey(view)]: up });
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
      ArrowUp: { [v]: clamp(value[v] + step) },
      ArrowDown: { [v]: clamp(value[v] - step) },
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    onChange(next);
  }
</script>

{#snippet view(name: View, h: number, list: ReturnType<typeof shapes>, caption: string, vName: string)}
  {@const px = value.width * W}
  {@const py = (1 - value[vKey(name)]) * h}
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
        <ellipse class="drum" cx={d.cx * W} cy={d.cy * h} rx={d.rx * W} ry={d.ry * h}><title>{d.label}</title></ellipse>
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
    {@render view('above', hAbove, aboveShapes, 'From above', 'Depth')}
    {@render view('front', hFront, frontShapes, 'From the front', 'Height')}
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
    fill: color-mix(in oklch, var(--text-faint) 18%, transparent);
    stroke: var(--text-faint);
    stroke-width: 0.75;
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
