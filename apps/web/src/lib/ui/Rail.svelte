<script lang="ts">
  /* A strip container — a flex row/column with consistent gap and an optional
     surface. Use for toolbars, lanes, control clusters. */
  import type { Snippet } from 'svelte';

  type Props = {
    orientation?: 'horizontal' | 'vertical';
    gap?: 'sm' | 'md' | 'lg';
    align?: 'start' | 'center' | 'end' | 'stretch';
    surface?: boolean;
    wrap?: boolean;
    class?: string;
    children: Snippet;
  };

  let {
    orientation = 'horizontal',
    gap = 'md',
    align = 'center',
    surface = false,
    wrap = false,
    class: klass,
    children,
  }: Props = $props();
</script>

<div class={['rail', orientation, `gap-${gap}`, `al-${align}`, klass]} class:surface class:wrap>
  {@render children()}
</div>

<style>
  .rail {
    display: flex;
    min-width: 0;
  }
  .horizontal {
    flex-direction: row;
  }
  .vertical {
    flex-direction: column;
  }
  .al-start {
    align-items: flex-start;
  }
  .al-center {
    align-items: center;
  }
  .al-end {
    align-items: flex-end;
  }
  .al-stretch {
    align-items: stretch;
  }
  .wrap {
    flex-wrap: wrap;
  }
  .gap-sm {
    gap: var(--space-1);
  }
  .gap-md {
    gap: var(--space-2);
  }
  .gap-lg {
    gap: var(--space-3);
  }
  .surface {
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
  }
</style>
