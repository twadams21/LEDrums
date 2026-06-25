<script lang="ts">
  /* Animated thumbnail of an effect, rendered with the SAME pattern sampler the
     3D kit uses, mapped onto a small 2D grid (x ≈ hoop angle, y ≈ hoop height).
     Driven by the effect's pattern + the instance/preset params. Throwaway. */
  import type { ParamValues, Pattern } from './sim';
  import type { PixelAttrs } from './kit';
  import { sampleWith } from './render';
  import { hueToRgb } from './kit';

  interface Props {
    pattern: Pattern;
    params: ParamValues;
    w?: number;
    h?: number;
  }
  let { pattern, params, w = 64, h = 36 }: Props = $props();

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

  $effect(() => {
    const cv = canvas;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    cv.width = w;
    cv.height = h;
    const cw = w / COLS;
    const ch = h / ROWS;
    // read params reactively so the thumb updates as the preset changes
    const p = params;
    const pat = pattern;
    const hue = num(p.hue, 0);
    const bright = num(p.brightness, 1);
    const t0 = performance.now();
    let raf = 0;

    const draw = (now: number): void => {
      const t = (now - t0) / 1000;
      ctx.fillStyle = '#0a0d12';
      ctx.fillRect(0, 0, w, h);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const [si, hoff] = sampleWith(pat, t, i, attrs, p);
          const amp = si * bright;
          if (amp <= 0.02) continue;
          const [R, G, B] = hueToRgb(hue + hoff, amp);
          ctx.fillStyle = `rgb(${R},${G},${B})`;
          ctx.fillRect(c * cw, r * ch, Math.ceil(cw), Math.ceil(ch));
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
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
