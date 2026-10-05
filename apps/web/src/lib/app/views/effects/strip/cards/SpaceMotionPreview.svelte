<script lang="ts">
  /* Which way a Dot flies through the kit's space — shown, and set, on the kit itself, with the
     effect running live (Tim, 2026-10-06: "we should use a graphic in the movement section as a way
     of marking the heading / elevation / direction … make this into a pre-visualiser, so i can see
     the dot / shape moving through 3d space"). Two views, as the visualiser's cameras show the kit:
     Top (x to the right, the drummer's side at the top) and Front (x to the right, up up). Every
     pixel is a faint dot; the REAL Dot effect renders each frame (core, on the kit's pixel model) and
     its lit pixels glow in their colours, the shape's centre ringed. An arrow from the start point
     shows the heading. Drag on Top to aim it (Heading), on Front to tilt it (Elevation); focused,
     ← → turn it, ↑ ↓ tilt it (Shift: finer). The loop restarts when the dots' life is over. Paused
     off-screen; with reduced motion, one still frame. Every drag is one undo step. */
  import { defaultParams, effectChain, Framebuffer, tryGetEffect, type PixelModel, type RenderContext } from '@ledrums/core';
  import { ticker } from '../../../../../trigger-lab/effect-thumb-ticker';

  type Value = number | boolean | string;
  let {
    model,
    params,
    headingKey,
    elevationKey,
    disabled = false,
    ariaLabel,
    onChange,
    onGestureStart,
    onGestureEnd,
  }: {
    /** The kit's pixel model, or null when the host can't say (no preview then). */
    model: PixelModel | null;
    /** The Dot's own params (the card's values). */
    params: Readonly<Record<string, Value>> | undefined;
    headingKey: string;
    elevationKey: string;
    disabled?: boolean;
    ariaLabel: string;
    onChange: (patch: Record<string, number>) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
  } = $props();

  const W = 112;
  type View = 'top' | 'front';
  const gen = tryGetEffect('dot');

  const span = (m: PixelModel, a: 'x' | 'y' | 'z') => Math.max(1e-6, m.bounds.max[a] - m.bounds.min[a]);
  const heightOf = (m: PixelModel | null, a: 'y' | 'z') => (m ? Math.round(Math.min(100, Math.max(48, (W * span(m, a)) / span(m, 'x')))) : 60);
  const hTop = $derived(heightOf(model, 'y'));
  const hFront = $derived(heightOf(model, 'z'));

  /** A world point in a view's pixels: Top has low y at the top; Front has z going up. */
  function project(m: PixelModel, view: View, x: number, y: number, z: number, h: number): [number, number] {
    const px = ((x - m.bounds.min.x) / span(m, 'x')) * W;
    const py = view === 'top' ? ((y - m.bounds.min.y) / span(m, 'y')) * h : (1 - (z - m.bounds.min.z) / span(m, 'z')) * h;
    return [px, py];
  }

  const num = (key: string, fallback: number) => {
    const v = params?.[key];
    return typeof v === 'number' ? v : fallback;
  };
  const heading = $derived(num(headingKey, 0));
  const elevation = $derived(num(elevationKey, 0));

  /** The Dot's params as the effect reads them: defaults, the card's values, beats at 120 bpm. */
  const resolved = $derived.by(() => {
    if (!gen) return {};
    const all: Record<string, Value> = { ...defaultParams(gen.paramSpec), ...(params ?? {}) };
    effectChain.resolveTempoParams(all, gen.paramSpec, 120);
    return all;
  });
  /** How long one run of the preview lasts before it starts again. */
  const loopMs = $derived.by(() => {
    const life = typeof resolved.life === 'number' ? resolved.life : 2000;
    return life > 0 ? Math.min(8000, life + 300) : 4000;
  });
  /** The world point the dots start from (the Start point in the kit's box). */
  const start = $derived.by(() => {
    if (!model) return { x: 0, y: 0, z: 0 };
    const { min, max } = model.bounds;
    const at = (a: 'x' | 'y' | 'z', key: string) => min[a] + (max[a] - min[a]) * Math.min(1, Math.max(0, num(key, 0.5)));
    return { x: at('x', 'spaceX'), y: at('y', 'spaceY'), z: at('z', 'spaceZ') };
  });

  let top = $state<HTMLCanvasElement>();
  let front = $state<HTMLCanvasElement>();
  let visible = $state(true);
  let reduced = $state(false);

  // The simulation: the effect's own state, restarted at each loop or when the kit changes.
  let simState: unknown = null;
  let simModel: PixelModel | null = null;
  let age = 0;
  let lastT = 0;
  let fb: Framebuffer | null = null;
  // Stable seed so a loop replays the same dots.
  const SEED = 7;

  function restart(m: PixelModel): void {
    simState = gen?.createState ? gen.createState(m, SEED) : null;
    simModel = m;
    age = 0;
  }

  function step(m: PixelModel, dt: number): void {
    if (!gen) return;
    if (simModel !== m || !simState) restart(m);
    age += dt;
    if (age > loopMs) restart(m);
    if (!fb || fb.pixelCount !== m.pixelCount) fb = new Framebuffer(m.pixelCount);
    fb.clear();
    const startDrum = typeof resolved.startDrum === 'string' && m.drumById.has(resolved.startDrum) ? resolved.startDrum : m.drums[0]?.drumId ?? '';
    const ctx: RenderContext = {
      model: m,
      timeMs: age,
      dt,
      transport: { timeMs: age, beat: (age / 500), bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true },
      triggers: [{ seq: 1, drumId: startDrum, note: 100, velocity: 1, timeMs: 0, ageMs: age }],
    };
    gen.render(ctx, resolved, fb, simState);
  }

  /** The colours the canvases paint with, read from the theme once per draw. */
  function palette(el: HTMLElement) {
    const css = getComputedStyle(el);
    const v = (name: string, fb2: string) => css.getPropertyValue(name).trim() || fb2;
    return { faint: v('--text-faint', '#666'), accent: v('--accent', '#9cf'), inset: v('--surface-inset', '#111'), border: v('--border-faint', '#333') };
  }

  function draw(canvas: HTMLCanvasElement, view: View, h: number): void {
    const m = model;
    const g = canvas.getContext('2d');
    if (!g || !m) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = palette(canvas);
    g.clearRect(0, 0, W, h);
    // The kit: every pixel a faint dot.
    g.fillStyle = c.faint;
    g.globalAlpha = 0.35;
    for (const p of m.pixels) {
      const [x, y] = project(m, view, p.world.x, p.world.y, p.world.z, h);
      g.fillRect(x - 0.5, y - 0.5, 1, 1);
    }
    g.globalAlpha = 1;
    // The pixels the effect lights, in their colours.
    if (fb) {
      const rgba = fb.rgba;
      for (let i = 0; i < m.pixelCount; i++) {
        const a = rgba[i * 4 + 3]!;
        if (a < 0.02) continue;
        const p = m.pixels[i]!.world;
        const [x, y] = project(m, view, p.x, p.y, p.z, h);
        g.fillStyle = `rgb(${Math.round(rgba[i * 4]! * 255)}, ${Math.round(rgba[i * 4 + 1]! * 255)}, ${Math.round(rgba[i * 4 + 2]! * 255)})`;
        g.globalAlpha = Math.min(1, 0.4 + a);
        g.beginPath();
        g.arc(x, y, 1.8, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // Each live dot's centre, ringed at its Size.
    const dots = (simState as { dots?: { p: { x: number; y: number; z: number }; gone?: boolean; bornMs: number }[] } | null)?.dots ?? [];
    const life = typeof resolved.life === 'number' ? resolved.life : 0;
    const ring = Math.max(2, ((typeof resolved.radius === 'number' ? resolved.radius : 120) / span(m, 'x')) * W);
    g.strokeStyle = c.accent;
    g.lineWidth = 1;
    for (const d of dots) {
      if (d.gone || d.bornMs > age || (life > 0 && age - d.bornMs >= life)) continue;
      const [x, y] = project(m, view, d.p.x, d.p.y, d.p.z, h);
      g.beginPath();
      g.arc(x, y, ring, 0, Math.PI * 2);
      g.stroke();
    }
    // The start point and the way it flies.
    const [sx, sy] = project(m, view, start.x, start.y, start.z, h);
    const hr = (heading * Math.PI) / 180;
    const er = (elevation * Math.PI) / 180;
    const dir = { x: Math.cos(er) * Math.cos(hr), y: Math.cos(er) * Math.sin(hr), z: Math.sin(er) };
    const reach = span(m, 'x') * 0.28;
    const [ex, ey] = project(m, view, start.x + dir.x * reach, start.y + dir.y * reach, start.z + dir.z * reach, h);
    g.strokeStyle = c.accent;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(ex, ey);
    g.stroke();
    const ang = Math.atan2(ey - sy, ex - sx);
    if (Math.hypot(ex - sx, ey - sy) > 3) {
      g.beginPath();
      g.moveTo(ex, ey);
      g.lineTo(ex - 5 * Math.cos(ang - 0.45), ey - 5 * Math.sin(ang - 0.45));
      g.lineTo(ex - 5 * Math.cos(ang + 0.45), ey - 5 * Math.sin(ang + 0.45));
      g.closePath();
      g.fillStyle = c.accent;
      g.fill();
    }
    g.beginPath();
    g.arc(sx, sy, 3, 0, Math.PI * 2);
    g.fillStyle = c.accent;
    g.fill();
  }

  function frame(): void {
    if (top) draw(top, 'top', hTop);
    if (front) draw(front, 'front', hFront);
  }

  // Pause off-screen.
  $effect(() => {
    const el = top;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => (visible = !!entry?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  });
  $effect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const on = () => (reduced = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  // The loop: the real effect, ~30 frames a second, restarted when the settings change.
  $effect(() => {
    const m = model;
    // Read what the drawing depends on, so a change of params or view redraws it.
    void resolved;
    void heading;
    void elevation;
    void hTop;
    void hFront;
    if (!m || !gen) return;
    restart(m);
    if (reduced || !visible) {
      // One still frame, a third of the way through a run.
      let t = 0;
      const until = loopMs * 0.35;
      while (t < until) {
        step(m, 33);
        t += 33;
      }
      frame();
      return;
    }
    lastT = 0;
    return ticker.subscribe((t) => {
      const dt = lastT ? Math.min(100, t - lastT) : 33;
      if (dt < 30) return;
      lastT = t;
      step(m, dt);
      frame();
    });
  });

  // ---- setting it ------------------------------------------------------------------------------
  let dragging: View | null = null;
  const round = (v: number) => Math.round(v);
  function pick(view: View, event: PointerEvent): void {
    const m = model;
    if (!m) return;
    const canvas = event.currentTarget as HTMLCanvasElement;
    const box = canvas.getBoundingClientRect();
    const h = view === 'top' ? hTop : hFront;
    const px = ((event.clientX - box.left) / box.width) * W;
    const py = ((event.clientY - box.top) / box.height) * h;
    const [sx, sy] = project(m, view, start.x, start.y, start.z, h);
    // Back to world units, so the angle is the kit's, not the picture's.
    const dx = ((px - sx) / W) * span(m, 'x');
    if (view === 'top') {
      const dy = ((py - sy) / h) * span(m, 'y');
      if (Math.hypot(dx, dy) < 1) return;
      const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      onChange({ [headingKey]: round(deg) % 360 });
    } else {
      const dz = (-(py - sy) / h) * span(m, 'z');
      // Tilt along the way it is heading: its run is the drag's distance across.
      const run = Math.abs(dx);
      if (Math.hypot(run, dz) < 1) return;
      onChange({ [elevationKey]: round(Math.max(-90, Math.min(90, (Math.atan2(dz, run) * 180) / Math.PI))) });
    }
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
  function key(event: KeyboardEvent): void {
    if (disabled) return;
    const by = event.shiftKey ? 1 : 5;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      onChange({ [headingKey]: (round(heading + (event.key === 'ArrowRight' ? by : -by)) + 360) % 360 });
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      onChange({ [elevationKey]: Math.max(-90, Math.min(90, round(elevation + (event.key === 'ArrowUp' ? by : -by)))) });
    }
  }
</script>

<div
  class="motion"
  class:disabled
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={`${ariaLabel}. Left and right turn it, up and down tilt it.`}
  aria-valuemin={0}
  aria-valuemax={359}
  aria-valuenow={round(heading)}
  aria-valuetext={`Heading ${round(heading)}°, elevation ${round(elevation)}°`}
  onkeydown={key}
>
  <div class="views">
    <figure>
      <canvas
        bind:this={top}
        style:width="{W}px"
        style:height="{hTop}px"
        onpointerdown={(e) => down('top', e)}
        onpointermove={(e) => move('top', e)}
        onpointerup={up}
        onpointercancel={up}
      ></canvas>
      <figcaption>Top · heading</figcaption>
    </figure>
    <figure>
      <canvas
        bind:this={front}
        style:width="{W}px"
        style:height="{hFront}px"
        onpointerdown={(e) => down('front', e)}
        onpointermove={(e) => move('front', e)}
        onpointerup={up}
        onpointercancel={up}
      ></canvas>
      <figcaption>Front · elevation</figcaption>
    </figure>
  </div>
  <p class="read">Heading {round(heading)}° · Elevation {round(elevation)}°</p>
</div>

<style>
  .motion {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-radius: var(--radius-1);
  }
  .motion:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .motion.disabled canvas {
    cursor: default;
    opacity: 0.6;
  }
  .views {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2);
  }
  figure {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
  }
  canvas {
    display: block;
    border-radius: var(--radius-1);
    background: var(--surface-inset);
    cursor: crosshair;
    touch-action: none;
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
