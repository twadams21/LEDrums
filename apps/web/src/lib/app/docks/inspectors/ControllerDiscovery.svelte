<script lang="ts">
  /* The "get the controller onto your subnet, then adopt it" guide — the two things an operator
     needs when Discover finds nothing: the concrete IP to set the box to, and a way to adopt a
     box at a known address anyway.

     Rendered at BOTH the moments that call for it: under a LOST alert (the likeliest cause is a
     subnet/IP mismatch) and in the un-adopted branch. That double placement is why this is one
     component rather than two — it replaces the pair of snippets ControllerStatusPanel used to
     render twice, unchanged.

     Split out of ControllerStatusPanel (INIT-09 S7). Pure presentational: plain values in, one
     callback out. */
  import Network from '@lucide/svelte/icons/network';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import type { NetworkAdapter } from '../../../ws/protocol-types';
  import AdoptByIpRow from './AdoptByIpRow.svelte';

  let {
    recommendation = null,
    canEdit = true,
    onAdopt,
  }: {
    /** The featured network adapter — drives the "set the A4 to …" card. null hides the card
        (no adapters known / offline) but keeps the manual adopt row, which still works. */
    recommendation?: NetworkAdapter | null;
    canEdit?: boolean;
    /** Adopt-IP: adopt this host AND copy it into the output settings (one click). */
    onAdopt?: (host: string) => void;
  } = $props();

  // A copy button for the recommended controller IP. The common flow: read the recommended IP, set
  // the box to it, then adopt it via the AdoptByIpRow below (its placeholder pre-fills that value).
  let copied = $state(false);

  async function copyRecommendedIp(): Promise<void> {
    const ip = recommendation?.recommendedIp;
    if (!ip || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(ip);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch {
      /* clipboard blocked — the value is right there to copy by hand */
    }
  }
</script>

<!-- The "different IP addresses" guide: your PC's adapter subnet + a concrete IP to set the box to.
     Hidden when no adapter is known (offline / adapters not yet enumerated). -->
{#if recommendation}
  <div class="recommend">
    <div class="rec-head">
      <Network size={13} aria-hidden="true" />
      <span class="rec-title">Put the controller on your subnet</span>
    </div>
    <p class="rec-pc">
      This PC · <span class="mono">{recommendation.name}</span> ·
      <span class="mono">{recommendation.cidr}</span>
    </p>
    <div class="rec-target">
      <span class="rec-set">Set the A4 to</span>
      <span class="rec-value mono">{recommendation.recommendedIp}</span>
      <button
        type="button"
        class="copy"
        onclick={copyRecommendedIp}
        aria-label="Copy recommended IP"
        title="Copy recommended IP"
      >
        {#if copied}<Check size={12} aria-hidden="true" />{:else}<Copy size={12} aria-hidden="true" />{/if}
      </button>
    </div>
    <p class="rec-hint">
      Mask <span class="mono">{recommendation.netmask}</span> · any address on
      <span class="mono">{recommendation.subnet}</span> works, then Discover.
    </p>
  </div>
{/if}

<!-- Manual adopt: connect to a controller at a known IP even when Discover can't see it (still on a
     different subnet, across a router, or simply missed). Seeds its placeholder from the recommended
     IP so the "set the box, then adopt it" flow is one glance. -->
<AdoptByIpRow recommendedIp={recommendation?.recommendedIp} {canEdit} {onAdopt} />

<style>
  /* Subnet recommendation — the "different IP addresses" guide. A calm accent-tinted card (info, not
     a fault): your PC's adapter subnet + a concrete IP to set the controller to, with one-tap copy. */
  .recommend {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklch, var(--accent) 30%, var(--border));
    border-radius: var(--radius-3);
    background: color-mix(in oklch, var(--accent) 8%, var(--surface-inset));
    /* Same gentle fade+rise as the sibling .alert/.takeover callouts, so the guidance reads as one
       family. Collapses to instant under reduced motion via the --dur-* token reset. */
    animation: alert-in var(--dur-220) var(--ease-out-quart);
  }
  /* Svelte renames keyframes per component, so this is ControllerBanners' `alert-in` copied rather
     than shared — the alternative is promoting it to a `-global-` name, which would leak one
     callout's entrance animation into every component in the app. */
  @keyframes alert-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }
  .rec-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--accent);
  }
  .rec-head :global(svg) {
    flex: none;
  }
  .rec-title {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
  }
  .rec-pc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
  }
  .recommend .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .rec-target {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-top: 2px;
  }
  .rec-set {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .rec-value {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.01em;
  }
  .copy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .copy:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }
  .copy:active {
    scale: 0.96;
  }
  .rec-hint {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
  }
</style>
