<script lang="ts">
  /* Animated thumbnail of an effect, painted as a pseudo-3D drum: the 26×13 thumb
     PixelModel projected with ONE fixed ¾-angle isometric camera (hoops as stacked
     ellipses), each pixel a soft glowing dot. Same camera, same drum, same hit
     cadence for every effect — thumbnail variance means EFFECT variance.

     Generator effects render on the small synthetic PixelModel (26×13); colours
     come directly from the Framebuffer (no hue round-trip). The projection table
     is precomputed once per size (thumb-projection.ts) — per frame we only
     recolour dots. Kit-wide-tagged effects get a second mini drum behind the main
     one so cross-drum travel reads.

     Powered by a shared ticker (one rAF loop for all thumbnails), with
     IntersectionObserver pause when offscreen and prefers-reduced-motion support
     (static frame at the effect's representative age — 35% of its dominant life). */
  import type { ParamValues } from './sim';
  import type { LabModel } from './kit';
  import { buildThumbPixelModel } from './kit';
  import { renderGeneratorThumbFrame, THUMB_LOOP_MS } from './effect-thumb-render';
  import { getThumbProjection, representativeAgeMs, type DotTable } from './thumb-projection';
  import { tryGetEffect } from '@ledrums/core';
  import { ticker } from './effect-thumb-ticker';
  import { triggerClock } from './signal-preview';

  interface Props {
    params: ParamValues;
    generatorId?: string;
    /** Accepted for caller compatibility but not used; generators render on the
        internal thumb model (buildThumbPixelModel). */
    labModel?: LabModel;
    w?: number;
    h?: number;
    /** Live-on-trigger mode (node faces): STATIC until the node's graph fires, then plays live
        from t=0 for one hit, then settles. Off by default → the continuous loop the effect
        library/gallery browses with. */
    triggered?: boolean;
    /** The graph's fire epoch (`performance.now()` ms) when `triggered`; null until it fires. */
    triggerAt?: number | null;
  }
  let { params, generatorId, w = 64, h = 36, triggered = false, triggerAt = null }: Props = $props();

  const num = (v: number | boolean | string | undefined, d: number) => (typeof v === 'number' ? v : d);

  /** Glow radius as a multiple of the core dot radius. */
  const GLOW_SCALE = 2.6;

  let canvas = $state<HTMLCanvasElement>();
  let genState = $state<unknown>(null);
  let genStateId = $state<string | null>(null); // Track which generatorId the state belongs to
  let isVisible = $state(true); // starts visible; observer only pauses after confirmed visible
  let prefersReduced = $state(false); // prefers-reduced-motion

  // Initialize or reset generator state when generatorId changes.
  // Uses the small thumb model (not labModel) so state geometry matches rendering.
  $effect(() => {
    if (generatorId && generatorId !== genStateId) {
      const gen = tryGetEffect(generatorId);
      if (gen?.createState) {
        genState = gen.createState(buildThumbPixelModel());
        genStateId = generatorId;
      }
    } else if (!generatorId) {
      genState = null;
      genStateId = null;
    }
  });

  // Per-fire reset (live-on-trigger): each new fire replays the effect from a clean state, so a
  // stateful generator (confetti / accumulators) restarts on the hit instead of drifting across
  // fires. Reads triggerAt (the dep) + generatorId and WRITES genState — never reads genState, so
  // it cannot form the self-referential-$effect loop that halts the app.
  $effect(() => {
    if (!triggered) return;
    triggerAt; // re-run on each fire
    if (generatorId) {
      const gen = tryGetEffect(generatorId);
      if (gen?.createState) genState = gen.createState(buildThumbPixelModel());
    }
  });

  // IntersectionObserver: detect when the canvas enters/leaves the viewport.
  // Guard: only allow setting isVisible=false once we've confirmed the element
  // was visible at least once — pre-layout false fires from portaled dialogs are
  // ignored so the initial isVisible=true keeps the ticker subscription alive.
  $effect(() => {
    const cv = canvas;
    if (!cv) return;

    let hasBeenVisible = false;

    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            if (entry) {
              if (entry.isIntersecting) {
                hasBeenVisible = true;
                isVisible = true;
              } else if (hasBeenVisible) {
                isVisible = false;
              }
              // Pre-layout false: hasBeenVisible is still false → leave isVisible=true.
            }
          })
        : null;

    if (observer) {
      observer.observe(cv);
      return () => observer.disconnect();
    }
  });

  // Monitor prefers-reduced-motion media query.
  $effect(() => {
    const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!mq) return;

    const handler = () => {
      prefersReduced = mq.matches;
    };
    handler(); // Set initial value

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  // Drawing logic: shared ticker subscription, gated by visibility and reduced-motion.
  $effect(() => {
    const cv = canvas;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    // Render at devicePixelRatio (capped) so the glowing dots stay crisp at the
    // small inspector/clip sizes; CSS size is unchanged (style width/aspect-ratio).
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    const dw = Math.round(w * dpr);
    const dh = Math.round(h * dpr);
    cv.width = dw;
    cv.height = dh;

    // Snapshot reactive props for the draw closure.
    const p = params;
    const genId = generatorId;
    const bright = num(p.brightness, 1);
    const gen = genId ? tryGetEffect(genId) : undefined;
    // Kit-wide effects get the background mini drum so cross-drum travel reads.
    const kitWide = gen?.tags?.includes('kit-wide') ?? false;
    const proj = getThumbProjection(dw, dh, kitWide);

    const paintDrum = (table: DotTable, pixels: [number, number, number][]): void => {
      const { shade } = table;
      for (let i = 0; i < pixels.length; i++) {
        const [rv, gv, bv] = pixels[i]!;
        const s = shade[i]! * bright;
        const R = Math.round(rv * s * 255);
        const G = Math.round(gv * s * 255);
        const B = Math.round(bv * s * 255);
        if (R < 3 && G < 3 && B < 3) continue; // unlit — the baked base layer shows the drum form
        // Soft glow halo + bright core, additive ('lighter') so neighbouring hoop
        // wedge sections bloom like the 3D visualiser's physical LED arcs.
        ctx.lineCap = 'butt';
        ctx.strokeStyle = `rgba(${R},${G},${B},0.28)`;
        ctx.lineWidth = table.lw[i]! * GLOW_SCALE;
        ctx.beginPath();
        ctx.ellipse(table.hx[i]!, table.hy[i]!, table.rx[i]!, table.ry[i]!, 0, table.a0[i]!, table.a1[i]!);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${R},${G},${B},0.95)`;
        ctx.lineWidth = table.lw[i]!;
        ctx.beginPath();
        ctx.ellipse(table.hx[i]!, table.hy[i]!, table.rx[i]!, table.ry[i]!, 0, table.a0[i]!, table.a1[i]!);
        ctx.stroke();
      }
    };

    const draw = (now: number): void => {
      const tMs = now;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(0, 0, dw, dh);
      if (proj.baseLayer) ctx.drawImage(proj.baseLayer as CanvasImageSource, 0, 0);

      // Time base: reduced-motion → a static frame at the effect's representative age
      // (35% of its dominant life param); live-on-trigger → local time since the node's
      // graph fired (static until it does); else the continuous gallery loop.
      let effectiveTms: number;
      if (prefersReduced) {
        effectiveTms = representativeAgeMs(gen?.paramSpec, p, THUMB_LOOP_MS);
      } else if (triggered) {
        effectiveTms = triggerClock(triggerAt, tMs).localMs;
      } else {
        effectiveTms = tMs;
      }

      // Every effect is generator-backed (U3): render the core generator on the internal
      // 26×13 thumb model. pixels[i] is [r,g,b] in 0..1, directly from the Framebuffer.
      if (!genId) return;
      const pixels = renderGeneratorThumbFrame(genId, p, effectiveTms, genState);
      if (!pixels) return;

      ctx.globalCompositeOperation = 'lighter';
      // Mini drum first (behind), echoing the same frame dimmed — the second drum of
      // the "kit" a kit-wide effect plays across.
      if (proj.mini) paintDrum(proj.mini, pixels);
      paintDrum(proj.main, pixels);
      ctx.globalCompositeOperation = 'source-over';
    };

    // Subscribe to the shared ticker only if visible and not in reduced-motion mode.
    // For reduced-motion, render once and don't subscribe.
    if (prefersReduced) {
      draw(0); // effectiveTms is the representative age; the wall-clock arg is unused
    } else if (isVisible) {
      const unsub = ticker.subscribe(draw);
      return unsub;
    }
  });
</script>

<canvas bind:this={canvas} class="thumb" style="width:{w}px; aspect-ratio:{w} / {h};"></canvas>

<style>
  .thumb {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-1);
    background: #0a0d12;
    /* Subtle image outline so the thumb reads as a viewport on any card surface
       (outline, not inset box-shadow — replaced elements paint over inset shadows). */
    outline: 1px solid rgba(255, 255, 255, 0.06);
    outline-offset: -1px;
  }
</style>
