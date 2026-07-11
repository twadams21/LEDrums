<script lang="ts">
  /* Per-universe rx — the row-level "not receiving" signal. Each row shows the universe number, its
     protocol, and grouped good/bad packet counts (+ priority); a dead universe tints its whole row in
     the live family so a single bad one stands out at a glance. Pure: the universe list in, nothing
     out. Renders nothing when the list is empty. */
  import StatusDot from '../../../ui/StatusDot.svelte';
  import type { ControllerUniverseRx } from '../../../ws/protocol-types';
  import { universeRxTone, universeProtocolLabel } from './output-status';

  let { universes }: { universes: ControllerUniverseRx[] } = $props();
</script>

{#if universes.length}
  <div class="universes">
    <span class="uni-head">Universes</span>
    {#each universes as u (u.protocol + ':' + u.uniNum)}
      <div class="uni-row" class:bad={!u.receiving}>
        <StatusDot tone={universeRxTone(u.receiving)} pulse={!u.receiving} />
        <span class="uni-num">U{u.uniNum}</span>
        <span class="uni-proto">{universeProtocolLabel(u.protocol)}</span>
        <span class="uni-counts">
          <span class="good">{u.inGood.toLocaleString('en-US')}</span
          ><span class="sep">/</span><span class="bad-count">{u.inBadSeq.toLocaleString('en-US')}</span>
          {#if u.priority != null}<span class="pri">p{u.priority}</span>{/if}
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .universes {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: var(--space-1);
  }
  .uni-head {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    margin-bottom: 2px;
  }
  .uni-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    color: var(--text);
    transition: background-color var(--dur-150) ease;
  }
  .uni-row.bad {
    background: var(--live-soft);
    color: var(--live-bright);
  }
  .uni-num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    min-width: 2.5em;
  }
  .uni-proto {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .uni-row.bad .uni-proto {
    color: color-mix(in oklch, var(--live-bright) 70%, transparent);
  }
  .uni-counts {
    margin-left: auto;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-2xs);
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
  }
  .uni-counts .good {
    color: var(--ok);
  }
  .uni-row.bad .uni-counts .good {
    color: inherit;
  }
  .uni-counts .sep,
  .uni-counts .bad-count {
    color: var(--text-faint);
  }
  .uni-counts .bad-count {
    color: var(--warn);
  }
  .uni-counts .pri {
    color: var(--text-faint);
    margin-left: 3px;
  }
</style>
