<script lang="ts">
  import { store } from '../store/app-store.svelte';

  const conn = $derived(store.connection);
  const connLabel = $derived(
    conn === 'open'
      ? 'connected'
      : conn === 'connecting'
        ? `connecting${store.reconnectAttempt > 0 ? ` (retry ${store.reconnectAttempt})` : ''}`
        : 'offline',
  );

  const midiLabel = $derived(
    store.midi === 'active'
      ? `MIDI · ${store.midiInputs.length} in`
      : store.midi === 'no-access'
        ? 'MIDI · no access'
        : 'MIDI · unavailable',
  );

  const out = $derived(store.outputStatus);
  const outState = $derived(out?.state ?? store.project?.output.state ?? 'disabled');
  const outLabel = $derived(
    outState === 'armed'
      ? 'LIVE'
      : outState === 'dry-run'
        ? 'dry-run'
        : out?.lastError
          ? 'error'
          : 'off',
  );
</script>

<footer class="bar">
  <span class="item conn conn-{conn}">
    <span class="dot"></span>WS · {connLabel}
  </span>

  <span class="item midi midi-{store.midi}">
    <span class="dot"></span>{midiLabel}
  </span>

  <span class="item out out-{outState}" class:err={!!out?.lastError && outState !== 'armed'}>
    <span class="dot"></span>OUT · {outLabel}
    {#if out}
      <em class="pk">{out.packetsSent} pkts</em>
    {/if}
  </span>

  {#if out?.lastError}
    <span class="errmsg" title={out.lastError}>{out.lastError}</span>
  {/if}

  <span class="item stats">
    {store.fps.toFixed(0)} fps · {store.latencyMs.toFixed(1)} ms · {store.model?.count ?? 0} px
  </span>
</footer>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 28px;
    padding: 0 12px;
    background: var(--panel);
    backdrop-filter: blur(8px);
    border-top: 1px solid var(--border);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    z-index: 20;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-faint);
  }
  .conn-open .dot {
    background: var(--ok);
    box-shadow: 0 0 6px var(--ok);
  }
  .conn-connecting .dot {
    background: var(--warn);
    animation: blink 0.8s steps(2) infinite;
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
  .out-armed {
    color: var(--live);
    font-weight: 700;
  }
  .out-armed .dot {
    background: var(--live);
    box-shadow: 0 0 8px var(--live);
    animation: blink 0.9s steps(2) infinite;
  }
  .out-dry-run .dot {
    background: var(--warn);
  }
  .item.err {
    color: var(--live);
  }
  .item.err .dot {
    background: var(--live);
  }
  .pk {
    font-style: normal;
    color: var(--text-faint);
  }
  .errmsg {
    color: var(--live);
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stats {
    margin-left: auto;
    color: var(--text-faint);
  }
  @keyframes blink {
    50% {
      opacity: 0.3;
    }
  }
</style>
