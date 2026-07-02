<script lang="ts">
  /* Motion tokens with LIVE demos: every mover runs off the real custom property,
     so the demo IS the token. A shared ping-pong drives all lanes in sync; under
     prefers-reduced-motion every --dur-* collapses to 0ms and the lanes simply
     snap — the exact policy the app ships. */
  import { onMount } from 'svelte';
  import CopyChip from '../CopyChip.svelte';

  const durations = [
    ['--dur-90', '90ms — state flips (hover/active)'],
    ['--dur-120', '120ms — dominant control transition'],
    ['--dur-150', '150ms — most transitions'],
    ['--dur-220', '220ms — panel / mode reveals'],
    ['--dur-320', '320ms — stage ⇄ studio crossfade'],
  ] as const;

  const easings = [
    ['--ease-control', 'control in/out — snappy settle'],
    ['--ease-out-quart', 'decelerating reveals'],
  ] as const;

  let on = $state(false);
  onMount(() => {
    const id = setInterval(() => (on = !on), 1200);
    return () => clearInterval(id);
  });
</script>

<section class="block" id="motion">
  <div class="block-head">
    <h2>Motion</h2>
    <p>
      Small, purposeful, interruptible. Durations are value-based tokens; under
      <code>prefers-reduced-motion</code> every one is 0ms (see the bottom of
      <code>tokens.css</code>) — behaviour never depends on an animation finishing.
    </p>
  </div>

  <div class="subgrid">
    <div class="sub">
      <h3>Durations</h3>
      <div class="lanes">
        {#each durations as [v, label] (v)}
          <div class="lane-row">
            <span class="lane-meta"><CopyChip text={v} /><span class="ll">{label}</span></span>
            <span class="lane"><i class="dot" class:on style="transition-duration: var({v})"></i></span>
          </div>
        {/each}
      </div>
    </div>

    <div class="sub">
      <h3>Easings — same 320ms, different curve</h3>
      <div class="lanes">
        {#each easings as [v, label] (v)}
          <div class="lane-row">
            <span class="lane-meta"><CopyChip text={v} /><span class="ll">{label}</span></span>
            <span class="lane"><i class="dot" class:on style="transition-duration: var(--dur-320); transition-timing-function: var({v})"></i></span>
          </div>
        {/each}
        <div class="lane-row">
          <span class="lane-meta"><code class="linear">linear</code><span class="ll">reference — never for UI</span></span>
          <span class="lane"><i class="dot" class:on style="transition-duration: var(--dur-320); transition-timing-function: linear"></i></span>
        </div>
      </div>
      <p class="micro">
        Rules of thumb: hover/active = <code>--dur-90</code>/<code>--dur-120</code> +
        <code>--ease-control</code>; reveals = <code>--dur-220</code> +
        <code>--ease-out-quart</code>; never animate layout the pointer is working in
        (the graph's no-lift rule).
      </p>
    </div>
  </div>
</section>

<style>
  .subgrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--space-5) var(--space-6);
  }
  .sub {
    min-width: 0;
  }
  h3 {
    font-size: var(--text-sm);
    color: var(--text);
    margin-bottom: var(--space-3);
  }
  .lanes {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .lane-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .lane-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .ll {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .linear {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    padding: 2px var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-1);
  }
  .lane {
    position: relative;
    display: block;
    height: 14px;
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-pill);
    container-type: inline-size;
  }
  .dot {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    transform: translateX(0);
    transition-property: transform;
    transition-timing-function: var(--ease-control);
  }
  .dot.on {
    /* travel the full lane minus the dot (container-query width = the live lane) */
    transform: translateX(calc(100cqw - 12px));
  }
  .micro {
    margin-top: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
