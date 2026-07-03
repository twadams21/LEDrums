<script lang="ts" generics="T">
  /* Master-detail scaffold — the layout SectionsView and ObjectsView both hand-roll: a left
     selector rail + a scrollable detail pane, with all content delegated to snippets so the
     primitive stays layout-only (no domain knowledge). It owns one thing — the current
     selection — and threads it to both snippets so the detail tracks the rail.

     `selected` is bindable (selection in/out). The `master` snippet renders the rail items and
     receives `{ selected, select }` so it can highlight the active item and set a new one; the
     `detail` snippet receives `{ selected }` so it renders the matching pane. Each snippet owns
     its own chrome (rail items, detail head + scroll list) — MasterDetail supplies only the two
     bordered surfaces and the column grid, matching the current Sections / Objects shell.

     Usage:
       <MasterDetail selected={type} railLabel="Object types">
         {#snippet master({ selected, select })}
           {#each TYPES as t (t.id)}
             <ListItem label={t.label} active={selected === t.id} onclick={() => select(t.id)} />
           {/each}
         {/snippet}
         {#snippet detail({ selected })}
           <header class="detail-head">…</header>
           <div class="objlist">…rows for {selected}…</div>
         {/snippet}
       </MasterDetail> */
  import type { Snippet } from 'svelte';

  type Props = {
    /** Current selection — bindable so a parent can read or drive it. */
    selected?: T;
    /** Left selector rail. Receives the live selection + a `select` setter for its items. */
    master: Snippet<[{ selected: T | undefined; select: (value: T) => void }]>;
    /** Right detail pane. Receives the live selection so it renders the matching content. */
    detail: Snippet<[{ selected: T | undefined }]>;
    /** aria-label for the rail `<nav>`. */
    railLabel?: string;
    /** Rail column width (any CSS length). Defaults to the Objects/Sections rail width. */
    railWidth?: string;
    class?: string;
  };

  let {
    selected = $bindable(),
    master,
    detail,
    railLabel = 'Selector',
    railWidth = '210px',
    class: klass,
  }: Props = $props();

  function select(value: T): void {
    selected = value;
  }
</script>

<div class={['md', klass]} style:--md-rail-width={railWidth}>
  <nav class="md-rail" aria-label={railLabel}>
    {@render master({ selected, select })}
  </nav>
  <section class="md-detail">
    {@render detail({ selected })}
  </section>
</div>

<style>
  .md {
    display: grid;
    grid-template-columns: var(--md-rail-width) minmax(0, 1fr);
    gap: var(--shell-gap);
    height: 100%;
    min-height: 0;
    -webkit-font-smoothing: antialiased;
  }
  /* left selector rail — bordered card, scrolls independently (mirrors .typerail) */
  .md-rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: 0;
    overflow: auto;
    padding: var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  /* right detail pane — bordered card; the snippet supplies its own head + scroll body */
  .md-detail {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
</style>
