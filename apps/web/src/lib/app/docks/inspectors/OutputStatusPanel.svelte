<script lang="ts">
  /* Output status panel (S03) — the confidence home for the Art-Net / sACN transport.
     Reads the server's OutputStatus (broadcast in every stats/state message) and the
     store-derived packets/s. Shows state, send rate, universes, target, protocol, and —
     prominently — the last error. This is a pure presentational composite (plain props,
     no store), so it demos in the styleguide on a stub and S48 can EXTEND it with the
     adopted PixLite controller's own rx stats + Identify / Adopt-IP below the fault row.

     Error styling uses the app's red error family (hue 25 — cf. PinGate, Monitor
     .type-error), a filled callout distinct from the small outlined state pill. */
  import RadioTower from '@lucide/svelte/icons/radio-tower';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { OutputStatus } from '../../../ws/protocol-types';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import StatusPill from '../../../ui/StatusPill.svelte';
  import ReadRow from './ReadRow.svelte';
  import {
    defaultPort,
    formatPacketsPerSecond,
    outputStateLabel,
    outputStateTone,
  } from './output-status';

  let {
    output,
    packetsPerSec,
    port,
  }: {
    /** Server transport truth from the stats/state stream; null when offline / pre-handshake. */
    output: OutputStatus | null;
    /** Store-derived send rate; null until two stats ticks differ (shown as "—"). */
    packetsPerSec: number | null;
    /** Configured transport port (not carried on OutputStatus) — falls back to the protocol default. */
    port?: number;
  } = $props();

  const tone = $derived(output ? outputStateTone(output.state) : 'muted');
  const stateLabel = $derived(output ? outputStateLabel(output.state) : 'Offline');
  const target = $derived(output ? `${output.host}:${port ?? defaultPort(output.protocol)}` : '');
  const protocolLabel = $derived(output ? (output.protocol === 'sacn' ? 'sACN' : 'Art-Net') : '');
</script>

<section class="panel" aria-label="Output status">
  <header class="head">
    <Eyebrow icon={RadioTower}>Output</Eyebrow>
    <StatusPill {tone} label={stateLabel} />
  </header>

  {#if output}
    <div class="readrows">
      <ReadRow label="Packets/s" value={formatPacketsPerSecond(packetsPerSec)} />
      <ReadRow label="Universes" value={String(output.universeCount)} />
      <ReadRow label="Target" value={target} />
      <ReadRow label="Protocol" value={protocolLabel} />
    </div>

    {#if output.lastError}
      <div class="fault" role="alert">
        <TriangleAlert size={14} class="fault-glyph" aria-hidden="true" />
        <div class="fault-body">
          <span class="fault-label">Last error</span>
          <p class="fault-msg">{output.lastError}</p>
        </div>
      </div>
    {/if}
  {:else}
    <p class="offline">No engine link — output status appears once the server is connected.</p>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .readrows {
    display: flex;
    flex-direction: column;
  }
  .offline {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }

  /* Prominent fault callout — filled red block, loud but not shouting. Enter is a
     gentle fade+rise that collapses to instant under reduced motion (via --dur-*). */
  .fault {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-top: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklch, var(--live) 45%, transparent);
    border-radius: var(--radius-3);
    background: var(--live-soft);
    animation: fault-in var(--dur-220) var(--ease-out-quart);
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
  @keyframes fault-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
</style>
