<script lang="ts">
  /* Inspector title block for a PROTECTED graph anchor (trigger / output). These nodes are
     not conversion targets — `KIND_OPTS` excludes them — so they can't show the shared kind
     selector every other node header carries; without a substitute they'd render an empty
     selector. This is that substitute: an optional accent-tinted leading icon, the node
     title (`h3`, like the patch / trigger `ihead` blocks), a mono sub-line, and an optional
     trailing action (e.g. duplicate). Same scale + rhythm as the other inspector headers so
     the anchors read as first-class inspector titles, not a special case. */
  import type { Component, Snippet } from 'svelte';

  let {
    icon,
    /** Icon colour (a CSS colour / var, e.g. `var(--role-output)`); defaults to the accent. */
    tint,
    title,
    sub,
    /** Right-aligned trailing control (an IconButton, etc.). */
    action,
  }: {
    icon?: Component;
    tint?: string;
    title: string;
    sub?: string;
    action?: Snippet;
  } = $props();
</script>

<header class="anchorhead">
  <div class="titles">
    <span class="titleline">
      {#if icon}
        {@const I = icon}
        <span class="ic" style={tint ? `color:${tint}` : undefined}><I size={15} aria-hidden="true" /></span>
      {/if}
      <h3>{title}</h3>
    </span>
    {#if sub}<span class="sub">{sub}</span>{/if}
  </div>
  {#if action}{@render action()}{/if}
</header>

<style>
  .anchorhead {
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
  .titleline {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .ic {
    display: inline-flex;
    flex: none;
    color: var(--accent);
  }
  h3 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    display: block;
    margin-top: 2px;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
</style>
