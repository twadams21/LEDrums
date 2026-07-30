<script lang="ts">
  /* One component demo: an eyebrow title, click-to-copy source pointer(s) resolved
     through the build-time manifest, an optional usage note, and the live demo. */
  import type { Snippet } from 'svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import CopyChip from './CopyChip.svelte';
  import { srcPath } from './source-pointer';

  let {
    title,
    src,
    note,
    wide = false,
    children,
  }: {
    title: string;
    /** Manifest key(s), e.g. `lib/ui/Splitter` — resolved to repo-relative paths. */
    src?: string | string[];
    note?: string;
    /** Span the full grid width. */
    wide?: boolean;
    children: Snippet;
  } = $props();

  const keys = $derived(src === undefined ? [] : Array.isArray(src) ? src : [src]);
</script>

<!-- `role="region"` + the card's own title as its accessible name makes every demo targetable by
     `pnpm ui-shot --route "?style" --target "<title>"` forever, per the ui-shot README's rule that a
     surface with an accessible name is screenshot-able (and that `data-shot` is a smell). No rendered
     pixels change. Adopted styleguide-wide by the INIT-09 veto round. -->
<div class="demo" class:wide role="region" aria-label={title}>
  <div class="head">
    <Eyebrow>{title}</Eyebrow>
    <span class="ptrs">
      {#each keys as key (key)}
        <CopyChip text={srcPath(key)} label={key.replace(/^lib\//, '')} title={`Copy source path: ${srcPath(key) ?? key}`} />
      {/each}
    </span>
  </div>
  <div class="body">
    {@render children()}
  </div>
  {#if note}<p class="note">{note}</p>{/if}
</div>

<style>
  .demo {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .ptrs {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
    min-width: 0;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .note {
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
