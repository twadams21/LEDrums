<script lang="ts">
  /* Compact engine telemetry for the lab header — ported from the main shell's
     StatusCluster onto the lab's design tokens. Shows the engine link state
     (dot + label), pixel count, render rate, and round-trip latency. The link
     fields are store-backed but inert today (local sim); the real WS values get
     wired in a later slice — see store.svelte.ts (link / latencyMs). */
  import type { TriggerLab } from './store.svelte';

  let { store }: { store: TriggerLab } = $props();

  // engine link → short label, matching the main shell's offline/sync/engine wording
  const linkLabel = $derived(store.link === 'open' ? 'engine' : store.link === 'connecting' ? 'sync' : 'offline');
  // pixel count lives on the serialized model; reuse the live fps the rAF loop measures
  const pixels = $derived(store.model?.count ?? 0);
</script>

<div class="status" aria-label="Engine status">
  <span class="link link-{store.link}" title="WebSocket link to engine">
    <span class="dot" aria-hidden="true"></span>
    {linkLabel}
    <span class="sr-only"> engine link</span>
  </span>

  <span class="stat" title="Pixel count">
    <b>{pixels}</b><i>px</i>
  </span>
  <span class="sep" aria-hidden="true"></span>
  <span class="stat" title="LED output frame rate">
    <b>{store.fps}</b><i>fps</i>
  </span>
  <span class="sep" aria-hidden="true"></span>
  <span class="stat" title="Engine round-trip latency">
    <b>{store.latencyMs}</b><i>ms</i>
  </span>
</div>

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  /* link pill — uppercase micro-label, dot colored by state */
  .link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    white-space: nowrap;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-faint);
    flex: none;
  }
  .link-open .dot {
    background: var(--ok);
    box-shadow: 0 0 6px color-mix(in oklch, var(--ok) 60%, transparent);
  }
  .link-open {
    color: var(--ok);
  }
  .link-connecting .dot {
    background: var(--warn);
    animation: blink 0.9s steps(2, jump-none) infinite;
  }
  .link-connecting {
    color: var(--warn);
  }
  /* readout chips — mono accent numeral + faint uppercase unit */
  .stat {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    white-space: nowrap;
  }
  .stat b {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--accent);
    min-width: 18px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .stat i {
    font-style: normal;
    opacity: 0.85;
  }
  .sep {
    width: 1px;
    height: 10px;
    background: var(--border);
    align-self: center;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  @keyframes blink {
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .link-connecting .dot {
      animation: none;
    }
  }
</style>
