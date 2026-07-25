<script lang="ts">
  /* A value the user has to retype somewhere else — a share URL, a room PIN, an OSC
     host:port destined for Sensory Percussion's settings. Mono, selectable, with a copy
     button that swaps to a check for a beat so the click is acknowledged without a toast.

     Presentational: it owns only the copied-flash timer. Failure is honest — if the
     Clipboard API is missing or refuses, the button does NOT flash success; the value is
     still visible and selectable, which is the real fallback. */
  import { onDestroy } from 'svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';

  type Props = {
    /** The exact text copied to the clipboard — also what is rendered. */
    value: string;
    /** Short leading label ("URL", "PIN"). Omit for a bare value row. */
    label?: string;
    /** Accessible name for the copy button; defaults to `Copy {label ?? value}`. */
    copyLabel?: string;
    class?: string;
  };

  let { value, label, copyLabel, class: klass }: Props = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const buttonLabel = $derived(copyLabel ?? `Copy ${label ?? value}`);

  async function copy(): Promise<void> {
    // Guard explicitly: optional chaining alone would resolve (not throw) when the
    // Clipboard API is absent, falsely flashing "copied" for a copy that never happened.
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => (copied = false), 1500);
    } catch {
      /* clipboard refused — the value stays visible and selectable */
    }
  }

  // The flash timer can outlive the component.
  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });
</script>

<div class={['cv', klass]}>
  {#if label}<span class="cv-label">{label}</span>{/if}
  <span class="cv-value" title={value}>{value}</span>
  <button type="button" class="cv-copy" aria-label={buttonLabel} title={buttonLabel} onclick={copy}>
    <!-- Both icons stay mounted and cross-fade, so the swap animates in BOTH directions
         (a toggled {#if} would pop). -->
    <span class="cv-icon" class:on={!copied}><Copy size={13} aria-hidden="true" /></span>
    <span class="cv-icon" class:on={copied}><Check size={13} aria-hidden="true" /></span>
  </button>
</div>

<style>
  .cv {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .cv-label {
    flex: none;
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .cv-value {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    /* Addresses and ports are digits the user reads across rows — keep them in columns. */
    font-variant-numeric: tabular-nums;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: all;
  }

  /* 26px visible button, extended to a 40px hit target by the ::after overlay. The two icons
     are stacked in one grid cell so the button never resizes mid-swap. */
  .cv-copy {
    position: relative;
    display: inline-grid;
    grid-template-areas: 'icon';
    place-items: center;
    flex: none;
    width: 26px;
    height: 26px;
    padding: 0;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    color: var(--text-faint);
    line-height: 0;
    cursor: pointer;
    transition-property: border-color, color, scale;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .cv-copy::after {
    content: '';
    position: absolute;
    inset: -7px;
  }
  .cv-copy:hover {
    border-color: var(--border-strong);
    color: var(--ink);
  }
  .cv-copy:active {
    scale: 0.96;
  }

  /* Cross-fade both directions — a toggled {#if} would pop on the way back. */
  .cv-icon {
    grid-area: icon;
    display: inline-flex;
    opacity: 0;
    scale: 0.25;
    filter: blur(4px);
    transition-property: opacity, scale, filter;
    transition-duration: var(--dur-150);
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
  }
  .cv-icon.on {
    opacity: 1;
    scale: 1;
    filter: blur(0);
  }
</style>
