<script lang="ts">
  /* Test-only harness for the canvas-visibility runes. They call $state/$effect, so they only run
     inside a component — this fixture calls them at init exactly as EffectThumb and SignalFace do,
     and renders their current values for the test to read. Not shipped UI; imported solely by
     canvas-visibility.test.ts. */
  import { elementVisibility, prefersReducedMotion } from './canvas-visibility.svelte';

  let el = $state<HTMLDivElement>();
  const visibility = elementVisibility(() => el);
  const reducedMotion = prefersReducedMotion();
</script>

<div bind:this={el} data-testid="target"></div>
<span data-testid="visible">{visibility.current}</span>
<span data-testid="reduced">{reducedMotion.current}</span>
