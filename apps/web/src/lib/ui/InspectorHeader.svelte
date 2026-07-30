<script lang="ts">
  /* The inspector's title block — an optional eyebrow, a bold title, a mono subtitle, with optional
     leading and trailing slots. Written out in five places before this component existed: the patch
     branch of Inspector.svelte, SectionInspector, TriggerSourceInspector, PlayNodeInspector and
     ModifierNodeInspector.

     NOT `lib/ui/PanelHeader` — that one is a fixed 38px uppercase strip with no subtitle, for the
     top of a dock. This is the taller identity header inside an inspector body.

     Leading (PlayNodeInspector's effect thumb, ModifierNodeInspector's role chip) and trailing (the
     IconButtons) content stays in the callers as snippets, so their local styles never migrate and
     nothing about their layout changes. */
  import type { Snippet } from 'svelte';
  import Eyebrow from './Eyebrow.svelte';

  let {
    eyebrow,
    title,
    sub,
    subCase = 'raw',
    leading,
    trailing,
  }: {
    /** Small uppercase label above the title (the patch stage, "Section"). */
    eyebrow?: string;
    title: string;
    /** Mono caption under the title. */
    sub?: string;
    /** `capitalize` title-cases the subtitle. Decided here rather than caller-side because `.sub`
        belongs to THIS component's template — a caller's scoping hash never lands on it. */
    subCase?: 'raw' | 'capitalize';
    /** Before the titles: a thumbnail, a role chip. */
    leading?: Snippet;
    /** After the titles: the header's own actions. */
    trailing?: Snippet;
  } = $props();
</script>

<header class="ihead">
  {#if leading}{@render leading()}{/if}
  <div class="titles">
    {#if eyebrow}<Eyebrow>{eyebrow}</Eyebrow>{/if}
    <h3>{title}</h3>
    {#if sub}<span class="sub" class:cap={subCase === 'capitalize'}>{sub}</span>{/if}
  </div>
  {#if trailing}{@render trailing()}{/if}
</header>

<style>
  .ihead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .sub {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  /* The one declaration that was not shared by all five sites: ModifierNodeInspector renders
     `{category} · modifier` off a lowercase category and title-cases it. */
  .sub.cap {
    text-transform: capitalize;
  }
</style>
