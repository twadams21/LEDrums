<script lang="ts">
  /* Reusable canvas primitive for node-face SIGNAL previews (doc 10, S38) — the drawing
     surface behind envelope/LFO/CC previews and the exposed-param-row live ticks. It owns
     the three pieces every live preview needs, factored out of EffectThumb so no preview
     spins its own rАF:

       · the SHARED thumbnail ticker (one rAF loop for the whole canvas) — `effect-thumb-ticker`
       · IntersectionObserver visibility gate — offscreen faces don't draw
       · prefers-reduced-motion — a single static frame at `staticMs`, no subscription

     It draws nothing itself: the caller passes `draw(g, tMs)` and paints the signal. The
     SIGNAL animates; the chrome does not (per Trent's graph prefs — no hover/click motion). */
  import { ticker } from './effect-thumb-ticker';
  import { PREVIEW_STATIC_MS } from './signal-preview';
  import { elementVisibility, prefersReducedMotion } from './canvas-visibility.svelte';

  interface Props {
    /** Paints one frame into the 2D context at ticker time `tMs` (already cleared). */
    draw: (g: CanvasRenderingContext2D, tMs: number) => void;
    w?: number;
    h?: number;
    /** The frame a reduced-motion face freezes at (default {@link PREVIEW_STATIC_MS}). */
    staticMs?: number;
    ariaLabel?: string;
  }
  let { draw, w = 56, h = 32, staticMs = PREVIEW_STATIC_MS, ariaLabel }: Props = $props();

  let canvas = $state<HTMLCanvasElement>();
  // Both gates are the shared runes (canvas-visibility.svelte.ts) — EffectThumb uses the same
  // pair, including the pre-layout guard that keeps a portaled preview's ticker alive.
  const visibility = elementVisibility(() => canvas);
  const reducedMotion = prefersReducedMotion();
  const isVisible = $derived(visibility.current);
  const prefersReduced = $derived(reducedMotion.current);


  // Drawing: subscribe the draw closure to the shared ticker, gated by visibility + reduced-motion.
  $effect(() => {
    const cv = canvas;
    if (!cv) return;
    const g = cv.getContext('2d');
    if (!g) return;
    cv.width = w;
    cv.height = h;
    const paint = draw; // snapshot the reactive prop for the closure

    const frame = (tMs: number): void => {
      g.clearRect(0, 0, w, h);
      paint(g, tMs);
    };

    if (prefersReduced) {
      frame(staticMs); // one static frame, no subscription
    } else if (isVisible) {
      return ticker.subscribe(frame);
    }
  });
</script>

<canvas
  bind:this={canvas}
  class="signal-face"
  style="width:{w}px; aspect-ratio:{w} / {h};"
  aria-label={ariaLabel}
></canvas>

<style>
  .signal-face {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-1);
    background: var(--surface-inset);
  }
</style>
