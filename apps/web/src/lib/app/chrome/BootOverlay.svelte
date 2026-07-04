<script lang="ts">
  /* Desktop boot overlay (S08). A full-screen takeover the web app shows while the desktop shell's
     server is starting, an OTA update is downloading, or boot failed. Driven entirely by the
     desktop bridge's reactive boot status via the pure {@link computeBootOverlay} view mapping — it
     renders nothing in a plain browser (active === false) or once the server is running.

     Composed from design-system tokens; the progress bar and spinner are token-styled locals (the
     settings dialog owns its own inline progress bar in S07 — this is the boot/restart takeover).
     Enter is split + staggered per make-interfaces-feel-better; the percentage uses tabular-nums so
     a ticking download never shifts the layout. */
  import type { BootStatus } from '../boot-reducer';
  import { computeBootOverlay } from './boot-overlay';
  import Logo from '../../ui/Logo.svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let { status, active }: { status: BootStatus; active: boolean } = $props();

  const view = $derived(computeBootOverlay(active, status));

  /** Whole megabytes (decimal MB, matching how download sizes are quoted). */
  function formatMb(bytes: number): string {
    return `${Math.round(bytes / 1_000_000)}`;
  }

  // "123 / 144 MB" — shown only while updating with a known content length.
  const sizeLabel = $derived(
    view?.variant === 'updating' && view.downloadedBytes != null && view.totalBytes != null
      ? `${formatMb(view.downloadedBytes)} / ${formatMb(view.totalBytes)} MB`
      : null,
  );
</script>

{#if view}
  <div
    class="boot-overlay"
    data-variant={view.variant}
    role="alertdialog"
    aria-modal="true"
    aria-label={view.title}
  >
    <div class="panel">
      <div class="brand">
        {#if view.variant === 'error'}
          <span class="badge badge-error" aria-hidden="true"><TriangleAlert size={24} /></span>
        {:else}
          <span class="badge" aria-hidden="true">
            <Logo size={30} />
            {#if view.variant === 'starting'}<span class="ring"></span>{/if}
          </span>
        {/if}
      </div>

      <h1 class="title">{view.title}</h1>
      <p class="message">{view.message}</p>

      {#if view.variant === 'updating'}
        <div class="progress">
          <div
            class="track"
            role="progressbar"
            aria-label="Update download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={view.progressPct ?? undefined}
          >
            {#if view.progressPct === null}
              <span class="fill indeterminate"></span>
            {:else}
              <span class="fill" style="width:{view.progressPct}%"></span>
            {/if}
          </div>
          {#if sizeLabel}
            <span class="size">{sizeLabel}</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .boot-overlay {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-toast) - 1); /* over app + dialogs; under transient toasts (restart notice) */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-6);
    /* Opaque takeover — the app behind is not usable mid boot/update. A faint radial lift keeps it
       from reading as a dead flat fill. */
    background:
      radial-gradient(120% 90% at 50% 38%, var(--surface) 0%, var(--bg) 60%),
      var(--bg);
    -webkit-font-smoothing: antialiased;
    animation: boot-scrim-in var(--dur-220) var(--ease-out-quart);
  }

  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: 22rem;
    text-align: center;
  }

  /* Staggered enter: each chunk fades up ~90ms after the last. */
  .brand,
  .title,
  .message,
  .progress {
    animation: boot-rise var(--dur-320) var(--ease-out-quart) both;
  }
  .brand {
    animation-delay: 40ms;
  }
  .title {
    animation-delay: 130ms;
  }
  .message {
    animation-delay: 200ms;
  }
  .progress {
    animation-delay: 270ms;
  }

  .badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-4);
    background: var(--surface-2);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-2);
  }
  .badge-error {
    color: var(--live);
    background: var(--live-soft);
    border-color: color-mix(in oklab, var(--live) 45%, transparent);
    box-shadow: none;
  }

  /* Spinner ring orbiting the logo while starting — a quarter-lit accent arc over a faint track. */
  .ring {
    position: absolute;
    inset: -5px;
    border-radius: calc(var(--radius-4) + 5px); /* concentric with the badge */
    border: 2px solid color-mix(in oklab, var(--text-faint) 22%, transparent);
    border-top-color: var(--accent);
    animation: boot-spin 760ms linear infinite;
  }

  .title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
    letter-spacing: var(--tracking-tight);
    color: var(--ink);
    text-wrap: balance;
  }
  .message {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }

  .progress {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: 17rem;
    max-width: 100%;
    margin-top: var(--space-2);
  }
  .track {
    position: relative;
    width: 100%;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent-dim), var(--accent));
    box-shadow: 0 0 10px color-mix(in oklab, var(--accent) 45%, transparent);
    transition: width var(--dur-220) var(--ease-out-quart);
  }
  /* Unknown percentage: a sweeping segment instead of a filled width. */
  .fill.indeterminate {
    width: 40%;
    animation: boot-sweep 1.15s var(--ease-control) infinite;
  }
  .size {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    color: var(--text-muted);
  }

  @keyframes boot-scrim-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes boot-rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes boot-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes boot-sweep {
    0% {
      transform: translateX(-110%);
    }
    100% {
      transform: translateX(275%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .boot-overlay,
    .brand,
    .title,
    .message,
    .progress {
      animation: none;
    }
    .ring {
      animation: none;
      border-top-color: var(--accent);
    }
    .fill {
      transition: none;
    }
    .fill.indeterminate {
      animation: none;
      width: 100%;
      opacity: 0.5;
    }
  }
</style>
