<script lang="ts">
  /* OSC input surface (#139) — the answer to "what do I type into Sensory Percussion?".

     Third-party senders (Sunhouse Sensory Percussion, Ableton / Max for Live devices) are
     configured by typing a host and a port into THEIR settings. Before this panel that pair
     existed only in the server source, so a user had no way to find it from inside the app.

     Three things, in the order a user needs them:
       1. the address(es) to send to, each one copyable in a click;
       2. whether the socket actually bound (an EADDRINUSE used to be entirely silent);
       3. whether packets are ARRIVING — the difference between "configured" and "working",
          via the same InputActivityBadge used for per-binding last-heard proof.

     Presentational apart from reading the store's server-authoritative `oscListen`. The fault
     block matches OutputStatusPanel's `.fault` idiom (live-toned callout + TriangleAlert). */
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import CopyableValue from '../../ui/CopyableValue.svelte';
  import InputActivityBadge from '../../ui/InputActivityBadge.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';

  let { store }: { store: TriggerLab } = $props();

  const osc = $derived(store.oscListen);
  const failed = $derived(osc?.status === 'error');
  /** What a sender should be pointed at. A machine with no LAN address can still be reached
      from the same box, so loopback is a real answer rather than an empty list. */
  const targets = $derived(
    osc ? (osc.hosts.length ? osc.hosts : ['127.0.0.1']).map((h) => `${h}:${osc.port}`) : [],
  );
  /** Live proof that packets are landing, whatever address they carry. */
  const heard = $derived(store.oscHeardBadge);
</script>

<section class="osc" aria-label="OSC input">
  <span class="olabel">
    OSC input<em class="ohint">{failed ? 'unavailable' : 'send from Sensory Percussion or Ableton'}</em>
  </span>

  {#if !osc}
    <p class="note faint">Connecting to the server…</p>
  {:else if failed}
    <StatusPill tone="live" label={`Not listening on udp:${osc.port}`} />
    <div class="fault" role="alert">
      <TriangleAlert size={14} class="fault-glyph" aria-hidden="true" />
      <div class="fault-body">
        <span class="fault-label">OSC bind failed</span>
        <p class="fault-msg">{osc.error ?? `Could not bind UDP port ${osc.port}.`}</p>
      </div>
    </div>
    <p class="note faint">
      Another app is probably holding udp:{osc.port}. Free it, or set <code>OSC_PORT</code> and
      restart the server.
    </p>
  {:else}
    <ul class="targets">
      {#each targets as target (target)}
        <li><CopyableValue value={target} copyLabel={`Copy OSC address ${target}`} /></li>
      {/each}
    </ul>
    <div class="foot">
      <StatusPill tone="ok" label={`Listening on udp:${osc.port}`} />
      {#if heard}
        <InputActivityBadge {...heard} />
      {:else}
        <span class="note faint">Nothing received yet</span>
      {/if}
    </div>
  {/if}
</section>

<style>
  .osc {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  /* Matches Field's label styling so the section sits in the dialog's rhythm. */
  .olabel {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .ohint {
    font-style: normal;
    color: var(--text-faint);
  }

  .targets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  /* Concentric: --radius-2 outer against the copy button's --radius-1 inside --space-2 padding. */
  .targets li {
    padding: var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
    /* The badge label can be a long OSC address — let it ellipsize, not push the pill out. */
    overflow: hidden;
  }

  .note {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: 1.45;
    text-wrap: pretty;
    color: var(--text-muted);
  }
  .note.faint {
    color: var(--text-faint);
  }
  code {
    font-family: var(--font-mono);
    color: var(--text);
  }

  /* Fault callout — same shape/tone as OutputStatusPanel's last-error block. */
  .fault {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-top: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklch, var(--live) 45%, transparent);
    border-radius: var(--radius-3);
    background: var(--live-soft);
  }
  .fault :global(.fault-glyph) {
    flex: none;
    color: var(--live-bright);
    /* optical: nudge the triangle down to sit on the label's cap height */
    margin-top: 1px;
  }
  .fault-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .fault-label {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--live-bright);
  }
  .fault-msg {
    margin: 0;
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--text);
    line-height: var(--leading-snug);
    text-wrap: pretty;
    overflow-wrap: anywhere;
  }
</style>
