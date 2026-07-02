<script lang="ts">
  /* Animated thumbnail of an effect, rendered with the SAME pattern sampler the
     3D kit uses, mapped onto a small 2D grid (x ≈ hoop angle, y ≈ hoop height).
     Driven by the effect's pattern + the instance/preset params.

     Generator effects render on a small synthetic PixelModel (26×13) so their
     output maps 1:1 onto the grid — pixel index i ↔ grid cell i. Colours come
     directly from the Framebuffer (no hue round-trip).

     Powered by a shared ticker (one rAF loop for all thumbnails), with
     IntersectionObserver pause when offscreen and prefers-reduced-motion support. */
  import type { ParamValues, Pattern } from './sim';
  import type { LabModel, PixelAttrs } from './kit';
  import { buildThumbPixelModel } from './kit';
  import { sampleWith } from './render';
  import { hueToRgb } from './kit';
  import { renderGeneratorThumbFrame } from './effect-thumb-render';
  import { tryGetEffect } from '@ledrums/core';
  import { ticker } from './effect-thumb-ticker';

  interface Props {
    pattern: Pattern;
    params: ParamValues;
    generatorId?: string;
    /** Accepted for caller compatibility but not used; generators render on the
        internal thumb model (buildThumbPixelModel). */
    labModel?: LabModel;
    w?: number;
    h?: number;
  }
  let { pattern, params, generatorId, w = 64, h = 36 }: Props = $props();

  const num = (v: number | boolean | string | undefined, d: number) => (typeof v === 'number' ? v : d);

  const COLS = 26;
  const ROWS = 13;
  const N = COLS * ROWS;

  const attrs: PixelAttrs = (() => {
    const angle01 = new Float32Array(N);
    const norm01 = new Float32Array(N);
    const nx = new Float32Array(N);
    const ny = new Float32Array(N);
    const nz = new Float32Array(N);
    const drumIndex = new Int16Array(N);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        angle01[i] = c / COLS;
        norm01[i] = r / (ROWS - 1);
        nx[i] = c / (COLS - 1);
        ny[i] = r / (ROWS - 1);
        nz[i] = 0.5;
      }
    }
    return { drumIndex, angle01, norm01, nx, ny, nz };
  })();

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

    cv.width = w;
    cv.height = h;
    const cw = w / COLS;
    const ch = h / ROWS;

    // Snapshot reactive props for the draw closure.
    const p = params;
    const pat = pattern;
    const genId = generatorId;
    const hue = num(p.hue, 0);
    const bright = num(p.brightness, 1);

    const draw = (now: number): void => {
      const t = (now - 0) / 1000;
      const tMs = now;

      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(0, 0, w, h);

      // Use a static frame (t=400ms) if reduced-motion is enabled.
      const effectiveT = prefersReduced ? 0.4 : t;
      const effectiveTms = prefersReduced ? 400 : tMs;

      // Branch: generator-backed vs pattern effect
      if (genId) {
        // Render the generator on the internal 26×13 thumb model.
        // pixels[i] is [r,g,b] in 0..1, directly from the Framebuffer.
        const pixels = renderGeneratorThumbFrame(genId, p, effectiveTms, genState);
        if (pixels) {
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              const i = r * COLS + c;
              const [rv, gv, bv] = pixels[i]!;
              const R = Math.round(rv * bright * 255);
              const G = Math.round(gv * bright * 255);
              const B = Math.round(bv * bright * 255);
              if (R === 0 && G === 0 && B === 0) continue;
              ctx.fillStyle = `rgb(${R},${G},${B})`;
              ctx.fillRect(c * cw, r * ch, Math.ceil(cw), Math.ceil(ch));
            }
          }
        }
      } else {
        // Pattern-backed effect (original fast path)
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const i = r * COLS + c;
            const [si, hoff] = sampleWith(pat, effectiveT, i, attrs, p);
            const amp = si * bright;
            if (amp <= 0.02) continue;
            const [R, G, B] = hueToRgb(hue + hoff, amp);
            ctx.fillStyle = `rgb(${R},${G},${B})`;
            ctx.fillRect(c * cw, r * ch, Math.ceil(cw), Math.ceil(ch));
          }
        }
      }
    };

    // Subscribe to the shared ticker only if visible and not in reduced-motion mode.
    // For reduced-motion, render once and don't subscribe.
    if (prefersReduced) {
      // Render a single static frame at t=400ms
      draw(400);
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
  }
</style>
