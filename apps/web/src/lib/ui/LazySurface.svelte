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
  <div class="load-space" aria-busy="true" aria-label={label}>
    {#if delayed === resource}<LoadFeedback {label} />{/if}
  </div>
{/if}

<style>
  .load-space { height: 100%; min-height: 160px; }
</style>
