<script lang="ts">
  /* Live value tick for an exposed modulation-target row (doc 10, S38). A thin bar on the
     right of a param row that fills with the row's current source signal (0..1) while the
     engine runs — sampled through core `sampleSource` via `paramRowSignal`, drawn on the
     shared {@link SignalFace} (one ticker, viewport-gated, reduced-motion → static). A row
     with no wired source sits at 0. */
  import SignalFace from '../../trigger-lab/SignalFace.svelte';

  interface Props {
    /** The row's current 0..1 signal at ticker time `tMs` (0 when no source is wired). */
    sample: (tMs: number) => number;
    w?: number;
    h?: number;
  }
  let { sample, w = 22, h = 6 }: Props = $props();

  let root = $state<HTMLElement>();
  let c = $state({ signal: '#7c9cff', track: '#3a4056' });
  $effect(() => {
    const el = root;
    if (!el || typeof getComputedStyle === 'undefined') return;
    const cs = getComputedStyle(el);
    const read = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
    c = {
      signal: read('--role-modulation', c.signal),
      track: read('--border-faint', c.track),
    };
  });

  const draw = (g: CanvasRenderingContext2D, tMs: number): void => {
    const v = Math.max(0, Math.min(1, sample(tMs)));
    g.fillStyle = c.track;
    g.fillRect(0, 0, w, h);
    g.fillStyle = c.signal;
    g.fillRect(0, 0, w * v, h);
  };
</script>

<span class="tick" bind:this={root}>
  <SignalFace {draw} {w} {h} ariaLabel="live modulation value" />
</span>

<style>
  .tick {
    display: inline-flex;
    align-items: center;
    line-height: 0;
  }
</style>
