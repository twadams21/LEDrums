<script lang="ts">
  /* The single most important status: is the rig transmitting? Reads across a
     dark room. Independent of the accent so it never gets mistaken for it. */
  import { store } from '../store/app-store.svelte';

  const out = $derived(store.outputStatus);
  const state = $derived(out?.state ?? store.project?.output.state ?? 'disabled');
  const hasError = $derived(!!out?.lastError && state !== 'armed');

  const label = $derived(
    hasError ? 'ERROR' : state === 'armed' ? 'LIVE' : state === 'dry-run' ? 'DRY-RUN' : 'OFF',
  );
</script>

<span
  class="pill state-{hasError ? 'error' : state}"
  role="status"
  title={out?.lastError ?? `Output ${state}`}
>
  <span class="dot"></span>
  <span class="label">{label}</span>
  {#if out && state !== 'disabled'}
    <span class="pkts tabular">{out.packetsSent.toLocaleString()}</span>
  {/if}
</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 28px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-2);
    border: 1px solid var(--border);
    background: var(--surface-2);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--text-faint);
    flex: none;
  }
  .pkts {
    font-family: var(--font-mono);
    font-weight: 400;
    color: var(--text-faint);
    font-size: var(--text-2xs);
  }

  .state-dry-run {
    color: var(--warn);
    border-color: color-mix(in oklch, var(--warn) 45%, transparent);
    background: color-mix(in oklch, var(--warn) 12%, var(--surface-2));
  }
  .state-dry-run .dot {
    background: var(--warn);
  }

  .state-armed {
    color: var(--live-bright);
    border-color: var(--live);
    background: color-mix(in oklch, var(--live) 22%, var(--surface));
    box-shadow: var(--live-glow);
    animation: live-pulse 1.1s var(--ease-out-quart) infinite;
  }
  .state-armed .dot {
    background: var(--live-bright);
    box-shadow: 0 0 8px var(--live-bright);
  }

  .state-error {
    color: var(--live-bright);
    border-color: var(--live);
    background: color-mix(in oklch, var(--live) 14%, var(--surface-2));
  }
  .state-error .dot {
    background: var(--live);
  }

  @keyframes live-pulse {
    50% {
      box-shadow: 0 0 4px color-mix(in oklch, var(--live) 30%, transparent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .state-armed {
      animation: none;
    }
  }
</style>
