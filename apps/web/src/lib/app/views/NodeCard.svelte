<script lang="ts">
  /* The ONE node card both graphs (Patch + Trigger) render — extracted from the
     original PatchNode so the Patch look is literally the shared look. A role/kind-
     tinted icon chip on the left, a title + mono sub line, and an optional thumbnail
     snippet on the right (play nodes pass an EffectThumb). Presentational only: it
     reflects the selected / dropTarget state it's handed; hover is pure CSS (instant) and
     the wire highlight lives in the view (see graph-hover). */
  import type { Component, Snippet } from 'svelte';
  import NodeIconChip from './NodeIconChip.svelte';

  type Props = {
    icon: Component;
    title: string;
    sub: string;
    /** CSS colour for the role/kind-tinted icon chip. */
    tint: string;
    /** Optional play-type sub-label (D3) — a small tinted chip under the title naming the
        node's collection (Hits / Waves / … / Canvas). Optional so Patch nodes are unaffected. */
    typeChip?: string;
    selected?: boolean;
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
    /** Optional content rendered INSIDE the card, below the head row and a divider (one
        border, one surface, concentric radii). Play/modifier nodes pass their exposed
        modulation-param rows here so params live in the node card, not a bolted-on card. */
    footer?: Snippet;
    /** Optional wiring handles anchored to the card HEAD row (position:relative parent), so
        their offsets track the head layout and don't drift when a footer grows the card. */
    leadHandles?: Snippet;
  };

  let {
    icon: Icon,
    title,
    sub,
    tint,
    typeChip,
    selected = false,
    dropTarget = false,
    stale = false,
    thumb,
    badge,
    footer,
    leadHandles,
  }: Props = $props();
</script>

<div
  class="card"
  class:sel={selected}
  class:drop={dropTarget}
  class:stale
  class:has-thumb={!!thumb}
  class:has-footer={!!footer}
  style="--tint:{tint}"
>
  <div class="card-head">
    {#if leadHandles}{@render leadHandles()}{/if}
    <span class="icon"><NodeIconChip icon={Icon} {tint} /></span>
    <span class="title">{title}</span>
    {#if typeChip}<span class="typechip">{typeChip}</span>{/if}
    <span class="sub">{sub}</span>
    {#if thumb}<span class="thumb">{@render thumb()}</span>{/if}
  </div>
  {#if footer}<div class="card-footer">{@render footer()}</div>{/if}
  {#if badge}<span class="badge">{@render badge()}</span>{/if}
</div>

<style>
  .card {
    position: relative; /* anchors the corner badge */
    width: 176px;
    text-align: left;
    background: var(--surface-2);
    border: 1.5px solid var(--border);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-1);
  }
  /* head row — the icon/title/sub grid. position:relative so leadHandles anchor to the
     HEAD, not the whole card, so a footer growing the card never drifts them. */
  .card-head {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      'icon title'
      'icon chip'
      'icon sub';
    align-items: center;
    column-gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
  }
  /* with a right-side thumbnail: add the third column + grow to fit it */
  .card.has-thumb {
    width: auto;
    min-width: 176px;
    max-width: 260px;
  }
  .card.has-thumb .card-head {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'icon title thumb'
      'icon chip thumb'
      'icon sub thumb';
  }
  /* exposed-param footer lives INSIDE the card: one border, one surface, an internal
     divider, and radii that echo the card corners (concentric). */
  .card-footer {
    padding: var(--space-1_5) var(--space-2) var(--space-2);
    border-top: 1px solid var(--border-faint);
  }
  /* hover highlights the border accent — pure CSS so it is INSTANT (one hover pattern per
     element class, item 1.9); the wire highlight that follows hover lives in graph-hover. */
  .card:hover {
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
  /* grid cell for the role/kind-tinted icon chip (the chip itself is NodeIconChip) */
  .icon {
    grid-area: icon;
    display: inline-flex;
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
  /* play-type sub-label (D3) — a compact tinted pill naming the node's collection. Sits
     between title and sub; its row collapses to 0 height when absent (no typeChip). */
  .typechip {
    grid-area: chip;
    justify-self: start;
    max-width: 100%;
    margin: 1px 0;
    padding: 1px 6px;
    border: 1px solid color-mix(in oklch, var(--tint) 45%, transparent);
    border-radius: var(--radius-pill);
    background: color-mix(in oklch, var(--tint) 12%, transparent);
    color: var(--tint);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: 1.2;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
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
