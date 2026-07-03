<script lang="ts">
  /* The ONE node card both graphs (Patch + Trigger) render — extracted from the
     original PatchNode so the Patch look is literally the shared look. A role/kind-
     tinted icon chip on the left, a title + mono sub line, and an optional thumbnail
     snippet on the right (play nodes pass an EffectThumb). Presentational only: it
     reflects the selected / hovered / dropTarget state it's handed; the lift + wire
     highlight live in the view (see graph-hover). */
  import type { Component, Snippet } from 'svelte';

  type Props = {
    icon: Component;
    title: string;
    sub: string;
    /** CSS colour for the role/kind-tinted icon chip. */
    tint: string;
    selected?: boolean;
    hovered?: boolean;
    dropTarget?: boolean;
    /** Degraded placeholder: the node's live model could not be resolved (a "stale node").
        Renders a dashed warn-tinted card so a projection/desync fault is VISIBLE on the
        canvas instead of a blank card (see TriggerNode / incident 09). */
    stale?: boolean;
    /** Optional right-side thumbnail (play nodes pass an EffectThumb). */
    thumb?: Snippet;
    /** Optional small corner indicator (top-right) — a secondary status/relationship marker
        that doesn't disturb the icon/title/sub/thumb grid. The trigger node passes the
        drum-link badge here (a source that is ALSO zone-mapped). */
    badge?: Snippet;
  };

  let {
    icon: Icon,
    title,
    sub,
    tint,
    selected = false,
    hovered = false,
    dropTarget = false,
    stale = false,
    thumb,
    badge,
  }: Props = $props();
</script>

<div
  class="card"
  class:sel={selected}
  class:hov={hovered}
  class:drop={dropTarget}
  class:stale
  class:has-thumb={!!thumb}
  style="--tint:{tint}"
>
  <span class="icon"><Icon size={16} aria-hidden="true" /></span>
  <span class="title">{title}</span>
  <span class="sub">{sub}</span>
  {#if thumb}<span class="thumb">{@render thumb()}</span>{/if}
  {#if badge}<span class="badge">{@render badge()}</span>{/if}
</div>

<style>
  .card {
    position: relative; /* anchors the corner badge */
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'icon title'
      'icon sub';
    align-items: center;
    column-gap: var(--space-2);
    width: 176px;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
    text-align: left;
    background: var(--surface-2);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-1);
  }
  /* with a right-side thumbnail: add the third column + grow to fit it */
  .card.has-thumb {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'icon title thumb'
      'icon sub thumb';
    width: auto;
    min-width: 176px;
    max-width: 260px;
  }
  /* hover highlights the border accent — the LIFT comes from the view nudging the
     node's xyflow position (a CSS transform here would detach handles + edges). */
  .card:hover,
  .card.hov {
    border-color: var(--accent-bright);
  }
  /* selected into the Inspector — same full-accent border as hover, plus a crisp ring
     so selection still reads when the node isn't hovered (wires do NOT light up) */
  .card.sel {
    border-color: var(--accent);
    /* box-shadow: 0 0 0 1px var(--accent), var(--shadow-1); */
  }
  /* a wire is being dropped onto this node (the whole node is the drop target) */
  .card.drop {
    border-color: var(--accent);
    border-style: dashed;
    /* box-shadow: 0 0 0 2px color-mix(in oklch, var(--accent) 55%, transparent), var(--shadow-1); */
  }
  /* stale placeholder: the live model is gone — a dashed warn card so the fault is
     visible on the canvas (a blank card told us nothing for a day). Never hides on hover. */
  .card.stale {
    border-style: dashed;
    border-color: var(--warn);
    background: color-mix(in oklch, var(--warn) 8%, var(--surface-2));
  }
  .card.stale .title {
    color: var(--warn);
  }
  /* signal-path role / kind colour rides the icon chip (icon + tinted wash) */
  .icon {
    grid-area: icon;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-2);
    color: var(--tint);
    background: color-mix(in oklch, var(--tint) 16%, transparent);
  }
  .title {
    grid-area: title;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    grid-area: sub;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .thumb {
    grid-area: thumb;
    display: inline-flex;
    align-items: center;
    margin-left: var(--space-1);
    line-height: 0;
  }
  /* a small corner marker riding the top-right border — a secondary relationship badge
     (the trigger node's drum-link). Sits on the corner so it never crowds the title/sub. */
  .badge {
    position: absolute;
    top: -7px;
    right: -7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-pill);
    color: var(--accent);
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
    box-shadow: var(--shadow-1);
    line-height: 0;
  }
</style>
