<script lang="ts">
  /* Animated thumbnail of an effect, rendered with the SAME pattern sampler the
     3D kit uses, mapped onto a small 2D grid (x ≈ hoop angle, y ≈ hoop height).
     Driven by the effect's pattern + the instance/preset params.

     Powered by a shared ticker (one rAF loop for all thumbnails), with
     IntersectionObserver pause when offscreen and prefers-reduced-motion support. */
  import type { ParamValues, Pattern } from './sim';
  import type { LabModel, PixelAttrs } from './kit';
  import { sampleWith } from './render';
  import { hueToRgb } from './kit';
  import { renderGeneratorThumbFrame } from './effect-thumb-render';
  import { tryGetEffect } from '@ledrums/core';
  import { ticker } from './effect-thumb-ticker';

  interface Props {
    pattern: Pattern;
    params: ParamValues;
    generatorId?: string;
    labModel?: LabModel;
    w?: number;
    h?: number;
  }
  let { pattern, params, generatorId, labModel, w = 64, h = 36 }: Props = $props();

  const num = (v: number | boolean | undefined, d: number) => (typeof v === 'number' ? v : d);

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
  let genState = $state<any>(null);
  let genStateId = $state<string | null>(null); // Track which generatorId the state belongs to
  let isVisible = $state(true); // IntersectionObserver: is the thumb visible?
  let prefersReduced = $state(false); // prefers-reduced-motion

  // Initialize or reset generator state when generatorId changes.
  $effect(() => {
    if (generatorId && labModel && generatorId !== genStateId) {
      const gen = tryGetEffect(generatorId);
      if (gen?.createState) {
        genState = gen.createState(labModel.pm);
        genStateId = generatorId;
      }
    } else if (!generatorId || !labModel) {
      genState = null;
      genStateId = null;
    }
  });

  // IntersectionObserver: detect when the canvas enters/leaves the viewport.
  $effect(() => {
    const cv = canvas;
    if (!cv) return;

    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            if (entry) {
              isVisible = entry.isIntersecting;
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
    const lab = labModel;
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
      if (genId && lab) {
        const pixels = renderGeneratorThumbFrame(genId, p, effectiveTms, lab.pm, genState);
        if (pixels) {
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              const i = r * COLS + c;
              const [inten, hoff] = pixels[i]!;
              const amp = inten * bright;
              if (amp <= 0.02) continue;
              const [R, G, B] = hueToRgb(hue + hoff, amp);
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
