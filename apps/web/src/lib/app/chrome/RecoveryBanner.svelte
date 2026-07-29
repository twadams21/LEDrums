<script lang="ts">
  /* Boot-recovery acknowledgement banner (Decision 8). When the server's boot ladder had to recover
     the live project — from a backup snapshot, or from a fresh default when no snapshot was readable
     — every connecting client shows this. It BLOCKS: the drummer may be about to author on top of a
     project that is missing their last edits, and finding that out later is the failure mode this
     exists to prevent. One acknowledge action dismisses it for the rest of the browser session.

     All copy + the ack rule live in the pure `recovery-banner.ts` view module (unit-tested there);
     this file is the token-composed surface. Composed from design-system tokens only — surface/ink
     ramps, --warn for the tone (warning, not the red fault alarm), --space-* rhythm, --dur/--ease
     motion. Per make-interfaces-feel-better: staggered enter, interruptible CSS transitions on the
     button, scale(0.96) on press, balanced/pretty text wrapping, ≥40px hit area on the action, and
     a reduced-motion path that drops every animation. */
  import type { BootRecoveryInfo } from '../../ws/protocol-types';
  import { acknowledge, isAcknowledged, recoveryBannerView, sessionAckStore, type AckStore } from './recovery-banner';
  import ArchiveRestore from '@lucide/svelte/icons/archive-restore';

  let {
    recovery,
    /** Injectable for tests; defaults to sessionStorage where available. */
    ackStore = sessionAckStore(),
    /** Move focus to the acknowledge action on mount. Off in the styleguide, where several framed
     * copies render at once and stealing focus would yank the page around. */
    autofocus = true,
  }: { recovery: BootRecoveryInfo | null; ackStore?: AckStore | null; autofocus?: boolean } = $props();

  // Acked in THIS page view. Seeded from the session store so a reconnect (which re-asserts the same
  // boot truth) does not re-raise a banner the drummer already dismissed.
  let ackedToken = $state<string | null>(null);

  const view = $derived(recovery ? recoveryBannerView(recovery) : null);
  const dismissed = $derived(
    recovery !== null && (ackedToken === recovery.reason || isAcknowledged(recovery, ackStore)),
  );
  const open = $derived(view !== null && !dismissed);

  // Blocking surface → the acknowledge action must be the focused control the moment it appears, so
  // a keyboard user is never trapped hunting for the only way out.
  const focusOnMount = (el: HTMLElement): void => {
    if (autofocus) el.focus();
  };

  function ack(): void {
    if (!recovery) return;
    acknowledge(recovery, ackStore);
    ackedToken = recovery.reason;
  }
</script>

{#if open && view}
  <!-- Deliberately not a dismissable Dialog: there is no Esc / outside-click exit, only the
       acknowledge action, because "I saw this" is the whole point of the surface. -->
  <div class="recovery-scrim" role="alertdialog" aria-modal="true" aria-labelledby="recovery-title">
    <div class="banner">
      <span class="glyph" aria-hidden="true"><ArchiveRestore size={20} /></span>

      <div class="copy">
        <h2 class="title" id="recovery-title">{view.title}</h2>
        <p class="message">{view.message}</p>
        <p class="rung">{view.rung}</p>
        <p class="reason">{view.reason}</p>
      </div>

      <button type="button" class="ack" onclick={ack} {@attach focusOnMount}>Got it</button>
    </div>
  </div>
{/if}

<style>
  .recovery-scrim {
    position: fixed;
    inset: 0;
    /* Above every authoring surface and dialog; below transient toasts, which must stay readable. */
    z-index: calc(var(--z-toast) - 1);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: var(--space-6) var(--space-5);
    background: var(--overlay);
    backdrop-filter: blur(3px);
    -webkit-font-smoothing: antialiased;
    animation: recovery-scrim-in var(--dur-220) var(--ease-out-quart);
  }

  /* A banner, not a modal card: full-width-ish, top-anchored, reading as a strip of bad news across
     the top of the instrument. Warn-toned edge + a soft warn wash over the panel surface. */
  .banner {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-3);
    width: min(46rem, 100%);
    padding: var(--space-3);
    background: color-mix(in oklab, var(--warn) 8%, var(--surface));
    border: 1px solid color-mix(in oklab, var(--warn) 42%, transparent);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-3);
  }

  /* Split + staggered enter — the strip lands, then its content settles into it. */
  .glyph,
  .copy,
  .ack {
    animation: recovery-rise var(--dur-320) var(--ease-out-quart) both;
  }
  .glyph {
    animation-delay: 40ms;
  }
  .copy {
    animation-delay: 130ms;
  }
  .ack {
    animation-delay: 220ms;
  }

  .glyph {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    /* Concentric with the banner: 34px well inside a --radius-3 (8px) card padded by --space-3. */
    border-radius: var(--radius-2);
    color: var(--warn);
    background: color-mix(in oklab, var(--warn) 16%, var(--surface-2));
  }

  .copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 650;
    letter-spacing: var(--tracking-tight);
    color: var(--ink);
    text-wrap: balance;
  }
  /* The consequence carries the weight — it is the sentence that matters. */
  .message {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 550;
    line-height: var(--leading-snug);
    color: var(--text);
    text-wrap: pretty;
  }
  .rung {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  /* The raw error, quiet and monospaced: available for a bug report, never shouting. */
  .reason {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    overflow-wrap: anywhere;
  }

  .ack {
    /* ≥40px hit area on both axes. */
    min-height: 40px;
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--on-accent);
    background: var(--accent);
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    cursor: pointer;
    /* Interruptible, and only the properties that actually change. */
    transition-property: background-color, scale, box-shadow;
    transition-duration: var(--dur-120);
    transition-timing-function: var(--ease-control);
  }
  .ack:hover {
    background: color-mix(in oklab, var(--accent) 88%, white);
  }
  .ack:active {
    scale: 0.96;
  }
  .ack:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent) 60%, transparent);
  }

  @keyframes recovery-scrim-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes recovery-rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .recovery-scrim,
    .glyph,
    .copy,
    .ack {
      animation: none;
    }
    .ack {
      transition: none;
    }
    .ack:active {
      scale: 1;
    }
  }

  /* Narrow: the action drops below the copy and spans, so it never squeezes the message. */
  @media (max-width: 34rem) {
    .banner {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .ack {
      grid-column: 1 / -1;
      width: 100%;
    }
  }
</style>
