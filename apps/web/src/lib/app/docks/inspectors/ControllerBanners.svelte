<script lang="ts">
  /* The controller panel's two LOUD banners — the pair the operator must never miss, kept
     together because they are mutually exclusive in practice and share one visual grammar
     (callout box, glyph, label, message) split across two deliberately different colour
     families:

       · takeover (amber warn) — the box is running synthetic data and IGNORING your live
         show. A state you CHOSE, so it warns rather than errors, and it carries its own
         one-click exit.
       · alert (red live/error) — LOST or not-receiving. Something is wrong, and it borrows
         the S03 fault treatment so it reads as the same family as an output fault.

     Split out of ControllerStatusPanel (INIT-09 S7) along the axis its git history moves on.
     Pure presentational: plain values in, one callback out. */
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import FlaskConical from '@lucide/svelte/icons/flask-conical';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import type { ControllerTestPattern } from '../../../ws/protocol-types';
  import { testPatternLabel, testPatternTarget } from './output-status';

  let {
    takeover = null,
    alert = false,
    lost = false,
    host,
    quietFor = '',
    canEdit = true,
    onBackToLive,
  }: {
    /** Active built-in test pattern, or null in normal LIVE mode. Non-null raises the takeover banner. */
    takeover?: ControllerTestPattern | null;
    /** The headline says something is wrong — raise the red alert. */
    alert?: boolean;
    /** The controller stopped answering entirely (vs. answering but not hearing pixel data). */
    lost?: boolean;
    /** The controller's IP, named in both alert messages. */
    host: string;
    /** Humanised "last seen" age, e.g. `12s ago` — only read in the LOST message. */
    quietFor?: string;
    canEdit?: boolean;
    onBackToLive?: () => void;
  } = $props();
</script>

{#if takeover}
  <!-- S49 takeover: the box is running synthetic data and IGNORING your live show. LOUD, but the
       amber warn family (not the red LOST/error family) — this is a deliberate state you chose,
       not a fault. Visible the ENTIRE time a pattern runs; the button is the one-click exit. -->
  <div class="takeover" role="status">
    <FlaskConical size={14} class="takeover-glyph" aria-hidden="true" />
    <div class="takeover-body">
      <span class="takeover-label">Test pattern active</span>
      <p class="takeover-msg">
        {testPatternLabel(takeover)} on {testPatternTarget(takeover)} — the controller is showing
        test data, <strong>not your live show</strong>.
      </p>
    </div>
    <button
      type="button"
      class="back-to-live"
      disabled={!canEdit}
      onclick={() => onBackToLive?.()}
    >
      <RotateCcw size={13} aria-hidden="true" /> Back to live data
    </button>
  </div>
{/if}

{#if alert}
  <div class="alert" role="alert">
    <TriangleAlert size={14} class="alert-glyph" aria-hidden="true" />
    <div class="alert-body">
      <span class="alert-label">{lost ? 'Controller lost' : 'Not receiving'}</span>
      <p class="alert-msg">
        {#if lost}
          No reply from {host} — last seen {quietFor}. Check power and the network link.
        {:else}
          {host} isn't hearing valid pixel data. Check the output target, cabling, and that output is armed.
        {/if}
      </p>
    </div>
  </div>
{/if}

<style>
  /* LOUD alert — LOST / not-receiving. Borrows the S03 fault treatment (live-soft fill, live-bright
     glyph) so it reads as the same "something is wrong with output" family. Fades + rises in,
     collapsing to instant under reduced motion via the global --dur-* reset. */
  .alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklch, var(--live) 45%, transparent);
    border-radius: var(--radius-3);
    background: var(--live-soft);
    animation: alert-in var(--dur-220) var(--ease-out-quart);
  }
  .alert :global(.alert-glyph) {
    flex: none;
    color: var(--live-bright);
    /* optical: sit the triangle on the label's cap height */
    margin-top: 1px;
  }
  .alert-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .alert-label {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--live-bright);
  }
  .alert-msg {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text);
    line-height: var(--leading-snug);
    text-wrap: pretty;
    overflow-wrap: anywhere;
  }
  /* Svelte scopes keyframe names per component, so ControllerDiscovery's recommendation card
     carries its own copy of this rather than sharing one via a `-global-` name — the same
     trade the `scan-spin` duplication already documents. */
  @keyframes alert-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }

  /* LOUD takeover banner (S49) — the amber warn family (deliberate state you chose), distinct from
     the red LOST/error alert above. A soft-pulsing left edge keeps it alive in peripheral vision the
     whole time a pattern runs, without the anxious full-element flash of an error. Collapses to a
     static bar under reduced motion (the --dur reset zeroes the animation duration). */
  .takeover {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklch, var(--warn) 45%, transparent);
    border-left: 3px solid var(--warn);
    border-radius: var(--radius-3);
    background: color-mix(in oklch, var(--warn) 15%, transparent);
    animation:
      alert-in var(--dur-220) var(--ease-out-quart),
      takeover-breathe 2.4s ease-in-out infinite;
  }
  .takeover :global(.takeover-glyph) {
    flex: none;
    color: var(--warn);
    margin-top: 1px;
  }
  .takeover-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .takeover-label {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--warn);
  }
  .takeover-msg {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text);
    line-height: var(--leading-snug);
    text-wrap: pretty;
    overflow-wrap: anywhere;
  }
  .takeover-msg strong {
    color: var(--warn);
    font-weight: 600;
  }
  /* Trailing exit — always reachable while the takeover shows (mirrors the .ops "Live" button so the
     one-click revert is present whether the operator's eye is on the banner or the controls). */
  .back-to-live {
    flex: none;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 28px;
    padding: var(--space-1) var(--space-2);
    background: color-mix(in oklch, var(--warn) 18%, var(--surface-inset));
    border: 1px solid color-mix(in oklch, var(--warn) 55%, transparent);
    border-radius: var(--radius-2);
    font-size: var(--text-xs);
    color: var(--text);
    white-space: nowrap;
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      background-color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .back-to-live :global(svg) {
    flex: none;
    opacity: 0.9;
  }
  .back-to-live:hover:not(:disabled) {
    border-color: var(--warn);
    background: color-mix(in oklch, var(--warn) 26%, var(--surface-inset));
  }
  .back-to-live:active:not(:disabled) {
    scale: 0.96;
  }
  .back-to-live:disabled {
    opacity: 0.5;
    cursor: default;
  }
  @keyframes takeover-breathe {
    50% {
      border-left-color: color-mix(in oklch, var(--warn) 55%, transparent);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .takeover {
      animation: none;
    }
  }
</style>
