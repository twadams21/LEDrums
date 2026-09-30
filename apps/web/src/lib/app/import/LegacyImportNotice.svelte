<script lang="ts" module>
  /** What an import keeps / drops — one sentence set shared by the notice and the dialog. */
  export const IMPORT_EXPLAINER =
    'Songs, sections, canvas scenes and transport come across. Your kit, patch and inputs are kept as they are. Graphs are not carried over, so each section starts with an empty grid. The old data is left untouched.';
</script>

<script lang="ts">
  /* The "Import shows from the previous version" notice (effect chains S06c). A dismissible
     card offered while old-format shows exist and none have been imported: "Review…" opens the
     confirm dialog (the caller owns it), the close button dismisses the offer via the api (the
     setlist menu keeps the on-demand action). `floating` pins it above the bottom bar at the
     workspace's lower-left (the app); `inline` renders in flow (styleguide demos).

     Motion: a short fade + 6px rise in, a softer fade out; none under reduced motion. No press
     animation on its buttons (S06 UI convention). */
  import { fade, fly } from 'svelte/transition';
  import IconButton from '../../ui/IconButton.svelte';
  import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
  import X from '@lucide/svelte/icons/x';
  import { importLabel } from './legacy-import-view';

  let {
    names,
    placement = 'floating',
    onReview,
    onDismiss,
  }: {
    /** Show names an import would bring across. */
    names: readonly string[];
    placement?: 'floating' | 'inline';
    onReview: () => void;
    onDismiss: () => void;
  } = $props();

  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const summary = $derived(
    names.length === 1 ? `“${names[0]}” is in the old show format.` : `${names.length} shows are in the old show format.`,
  );
</script>

<div
  class="notice"
  class:floating={placement === 'floating'}
  role="region"
  aria-label="Import shows from the previous version"
  data-legacy-import-notice
  in:fly={{ y: reduced ? 0 : 6, duration: reduced ? 0 : 200 }}
  out:fade={{ duration: reduced ? 0 : 120 }}
>
  <span class="ic" aria-hidden="true"><ArchiveRestore size={16} /></span>
  <div class="text">
    <p class="title">Import shows from the previous version</p>
    <p class="body">{summary} {IMPORT_EXPLAINER}</p>
    <div class="actions">
      <button type="button" class="primary" onclick={onReview}>{importLabel(names.length)}…</button>
      <button type="button" class="ghost" onclick={onDismiss}>Not now</button>
    </div>
  </div>
  <span class="close">
    <IconButton icon={X} label="Dismiss import notice" size={14} onclick={onDismiss} />
  </span>
</div>

<style>
  .notice {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-2);
    width: min(400px, calc(100vw - 2 * var(--space-4)));
    padding: var(--space-3);
    background: var(--surface-2);
    border-radius: var(--radius-card);
    box-shadow:
      0 0 0 1px var(--border),
      var(--shadow-2);
    -webkit-font-smoothing: antialiased;
  }
  .notice.floating {
    position: fixed;
    left: calc(var(--pad, var(--space-2)) + var(--space-3));
    bottom: calc(var(--content-bottom, 64px) + var(--space-3));
    z-index: var(--z-sticky);
  }
  .ic {
    display: inline-flex;
    padding-top: 1px;
    color: var(--accent);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--ink);
    text-wrap: balance;
  }
  .body {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .actions button {
    min-height: 28px;
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
  }
  /* S06 UI convention: no click animations — opt out of the global press scale. */
  .actions button:active {
    scale: 1;
  }
  .close {
    margin: calc(-1 * var(--space-1)) calc(-1 * var(--space-1)) 0 0;
  }
</style>
