<script lang="ts">
  /* The read-only thumbnail rendering of a {@link CurveField} value — the shape
     with nothing else: no handles, no controls, no interaction. Sized for a node
     face (the 56×32 slot `NodeSignalPreview` gives an envelope), where the full
     control would be illegible and its hit areas unusable.

     Deliberately a separate component rather than a mode on CurveField: a
     thumbnail must stay cheap enough to render dozens of at once, so it carries
     none of the gesture, clock or commit machinery. */
  import { curvePath, normalizeCurve, type CurveBox, type CurveValue } from './curve-field';

  type Props = {
    value: CurveValue;
    width?: number;
    height?: number;
    /** Sampled points across the field; the default is right for a thumbnail. */
    samples?: number;
    /** Names the shape for assistive tech; omit where a label already sits beside it. */
    ariaLabel?: string;
    class?: string;
  };

  let { value, width = 56, height = 32, samples = 32, ariaLabel, class: klass }: Props = $props();

  const box = $derived<CurveBox>({ width, height, pad: 3 });
  const paths = $derived(curvePath(normalizeCurve(value), box, samples));
</script>

<svg
  class={['curve-mini', klass]}
  viewBox={`0 0 ${width} ${height}`}
  {width}
  {height}
  role={ariaLabel ? 'img' : 'presentation'}
  aria-label={ariaLabel}
>
  <path class="area" d={paths.area} />
  <path class="curve" d={paths.line} />
</svg>

<style>
  .curve-mini {
    display: block;
    /* No preserveAspectRatio override: the viewBox is px-true, so the shape is
       never stretched and the stroke keeps an even weight at any size. */
  }
  .area {
    fill: color-mix(in oklch, var(--accent) 16%, transparent);
    stroke: none;
  }
  .curve {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
