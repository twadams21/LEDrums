<script lang="ts">
  /* Status indicator: a coloured dot (or custom leading snippet) plus a label,
     in a pill. Wraps the recurring "state -> label + animated dot" pattern
     (output link state, save status, …) so the look lives in one place.
     Token-driven; the dot's pulse and the colour transition both collapse
     under prefers-reduced-motion (via the global --dur-* reset). */
  import type { Snippet } from 'svelte';
  import StatusDot, { type StatusTone } from './StatusDot.svelte';

  type Props = {
    tone?: StatusTone;
    label?: string;
    /** Animate the leading dot (e.g. connecting / saving). */
    pulse?: boolean;
    title?: string;
    class?: string;
    /** Replaces the default dot — e.g. a spinner/check icon. */
    leading?: Snippet;
    /** Replaces the plain `label` text when richer content is needed. */
    children?: Snippet;
  };

  let {
    tone = 'muted',
    label,
    pulse = false,
    title,
    class: klass,
    leading,
    children,
  }: Props = $props();
</script>

<span class={['pill', `pill-${tone}`, klass]} {title} aria-label={label}>
  {#if leading}{@render leading()}{:else}<StatusDot {tone} {pulse} />{/if}
  {#if children}{@render children()}{:else if label}{label}{/if}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px var(--space-3);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface-inset);
    color: var(--text-muted);
    white-space: nowrap;
    transition-property: color, border-color, background-color;
    transition-duration: var(--dur-2);
  }
  .pill-ok {
    color: var(--ok);
    border-color: color-mix(in oklch, var(--ok) 45%, transparent);
  }
  .pill-warn {
    color: var(--warn);
    border-color: color-mix(in oklch, var(--warn) 45%, transparent);
  }
  .pill-live {
    color: var(--live);
    border-color: color-mix(in oklch, var(--live) 55%, transparent);
    background: var(--live-soft);
  }
  .pill-accent {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 50%, transparent);
    background: var(--accent-soft);
  }
  .pill-muted {
    color: var(--text-muted);
  }
</style>
