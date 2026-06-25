<script lang="ts">
  /* Output status pill. Today the only signal the web app has for "is real LED
     output running" is the engine-link state (Art-Net arming is server-side — see
     the redesign plan's follow-ups), so the pill is link-derived: open ⇒ LIVE
     (the server engine is driving output), connecting ⇒ SYNC, offline ⇒ LOCAL
     (local sim preview only). A true armed/dry-run/off control is a later slice. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';

  let { store }: { store: TriggerLab } = $props();

  const state = $derived(
    store.link === 'open' ? 'live' : store.link === 'connecting' ? 'sync' : 'local',
  );
  const label = $derived(state === 'live' ? 'LIVE' : state === 'sync' ? 'SYNC' : 'LOCAL');
  const title = $derived(
    state === 'live'
      ? 'Server engine connected — driving LED output'
      : state === 'sync'
        ? 'Connecting to the server engine…'
        : 'No engine link — local preview only',
  );
</script>

<span class="pill pill-{state}" {title} aria-label="Output {label}">
  <span class="dot" aria-hidden="true"></span>
  {label}
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
    color: var(--text-faint);
    white-space: nowrap;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    flex: none;
  }
  .pill-live {
    color: var(--live);
    border-color: color-mix(in oklch, var(--live) 55%, transparent);
    background: var(--live-soft);
  }
  .pill-live .dot {
    box-shadow: 0 0 8px color-mix(in oklch, var(--live) 70%, transparent);
  }
  .pill-sync {
    color: var(--warn);
    border-color: color-mix(in oklch, var(--warn) 45%, transparent);
  }
  .pill-sync .dot {
    animation: op-blink 0.9s steps(2, jump-none) infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .pill-sync .dot {
      animation: none;
    }
  }
  @keyframes op-blink {
    50% {
      opacity: 0.3;
    }
  }
</style>
