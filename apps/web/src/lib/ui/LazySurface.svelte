<script lang="ts" generics="T">
  import { untrack, type Snippet } from 'svelte';
  import type { LazyResource } from './lazy-resource.svelte';
  import LoadFeedback from './LoadFeedback.svelte';

  let { resource, label, children }: {
    resource: LazyResource<T>;
    label: string;
    children: Snippet<[T]>;
  } = $props();
  const currentState = $derived(resource.state);
  // Associate the timer with its resource, so a fast route change cannot inherit
  // another route's feedback. Loaded resources render synchronously, even on remount.
  let delayed = $state.raw<LazyResource<T> | null>(null);
  $effect(() => {
    const current = resource;
    untrack(() => { void current.load(); });
    const timer = setTimeout(() => { delayed = current; }, 200);
    return () => clearTimeout(timer);
  });
</script>

{#if currentState.status === 'ready'}
  {@render children(currentState.value)}
{:else if currentState.status === 'error'}
  <LoadFeedback {label} failed onRetry={currentState.retryable ? () => { void resource.retry(); } : undefined} />
{:else}
  <!-- The busy reserve and the live region are siblings: assistive tech may
       suppress announcements from inside an aria-busy subtree, and the region
       exists from mount so its later text change is a real live update. -->
  <div class="load-space">
    <div class="load-reserve" aria-busy="true" aria-label={label}></div>
    <LoadFeedback {label} pending={delayed === resource} />
  </div>
{/if}

<style>
  .load-space { display: grid; height: 100%; min-height: 160px; }
  .load-space > :global(*) { grid-area: 1 / 1; min-width: 0; }
</style>
