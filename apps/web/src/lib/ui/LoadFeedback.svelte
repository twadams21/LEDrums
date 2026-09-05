<script lang="ts">
  /* A quiet, honest code-load state. No fabricated progress, moving skeleton or
     minimum display time. The caller delays pending feedback, never ready content. */
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let { label, failed = false, onRetry }: {
    label: string;
    failed?: boolean;
    onRetry?: () => void;
  } = $props();
</script>

<div class="load-feedback" role={failed ? 'alert' : 'status'} aria-atomic="true">
  {#if failed}
    <TriangleAlert size={16} class="load-glyph" aria-hidden="true" />
    <p><strong>Couldn’t load {label}.</strong>
      {#if onRetry}Try again. If it still fails, reopen the app when it’s safe to interrupt.
      {:else}Reopen the app when it’s safe to interrupt. Saved edits are kept.{/if}
    </p>
    {#if onRetry}<button type="button" onclick={onRetry}>Try again</button>{/if}
  {:else}
    <p>Loading {label}…</p>
  {/if}
</div>

<style>
  .load-feedback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    min-height: 160px;
    height: 100%;
    padding: var(--space-4);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: center;
  }
  p { margin: 0; max-width: 44ch; text-wrap: pretty; }
  strong { color: var(--text); font-weight: 600; }
  .load-feedback :global(.load-glyph) { color: var(--warn); flex: none; }
  button { min-height: 40px; }
</style>
