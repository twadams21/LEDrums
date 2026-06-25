<script lang="ts">
  /* Compact engine telemetry for the shell bars: link, MIDI, render rate. */
  import { store } from '../store/app-store.svelte';

  const conn = $derived(store.connection);
  const connLabel = $derived(
    conn === 'open'
      ? 'engine'
      : conn === 'connecting'
        ? `sync${store.reconnectAttempt > 0 ? ` ${store.reconnectAttempt}` : ''}`
        : 'offline',
  );
  const midiLabel = $derived(
    store.midi === 'active'
      ? `${store.midiInputs.length} MIDI`
      : store.midi === 'no-access'
        ? 'no MIDI'
        : 'no MIDI',
  );
</script>

<div class="cluster" aria-label="Engine status">
  <span class="stat conn-{conn}" title="WebSocket link to engine">
    <span class="dot"></span>{connLabel}
  </span>
  <span class="stat midi-{store.midi}" title="WebMIDI access">
    <span class="dot"></span>{midiLabel}
  </span>
  <span class="stat readout tabular" title="Render rate · round-trip · pixels">
    {store.fps.toFixed(0)}<i>fps</i>
    <span class="sep"></span>
    {store.latencyMs.toFixed(0)}<i>ms</i>
    <span class="sep"></span>
    {store.model?.count ?? 0}<i>px</i>
  </span>
</div>

<style>
  .cluster {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-xs);
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-faint);
    flex: none;
  }
  .conn-open .dot {
    background: var(--ok);
    box-shadow: 0 0 6px color-mix(in oklch, var(--ok) 60%, transparent);
  }
  .conn-connecting .dot {
    background: var(--warn);
    animation: blink 0.9s steps(2, jump-none) infinite;
  }
  .conn-closed .dot {
    background: var(--live);
  }
  .midi-active .dot {
    background: var(--ok);
  }
  .midi-no-access .dot {
    background: var(--warn);
  }
  .readout {
    font-family: var(--font-mono);
    color: var(--text-faint);
    gap: var(--space-1);
  }
  .readout i {
    font-style: normal;
    opacity: 0.65;
    margin-left: 1px;
  }
  .sep {
    width: 1px;
    height: 10px;
    background: var(--border);
    margin: 0 1px;
  }
  @keyframes blink {
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .conn-connecting .dot {
      animation: none;
    }
  }
</style>
