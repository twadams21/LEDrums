<script lang="ts">
  /* ToastHost — renders the shared {@link toastStore} as a top-centre stack (S44). Mount ONCE
     near the app root (AuthorShell). Each toast descends in with a soft fade and leaves subtler
     than it arrived; role rides an icon + text + a slight background wash (never colour alone),
     and the whole card is dismissible with a ≥40px hit target. Reduced motion collapses every
     transition to 0ms. */
  import { fly, fade } from 'svelte/transition';
  import { toastStore, type ToastTone } from './toast.svelte';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Info from '@lucide/svelte/icons/info';
  import X from '@lucide/svelte/icons/x';

  const ICONS = { info: Info, success: CircleCheck, error: CircleAlert } as const;

  // Reduced motion is policy, not vibes: collapse enter/exit distance + duration to nothing.
  let reduced = $state(false);
  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    const on = (): void => void (reduced = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  // Top-anchored stack: enter by descending from just above (negative Y), not rising from below.
  const enterY = $derived(reduced ? 0 : -10);
  const enterMs = $derived(reduced ? 0 : 240);
  const exitMs = $derived(reduced ? 0 : 140);

  const iconFor = (tone: ToastTone) => ICONS[tone];
</script>

{#if toastStore.items.length > 0}
  <div class="toast-host" role="region" aria-label="Notifications" aria-live="polite">
    {#each toastStore.items as toast (toast.id)}
      {@const Icon = iconFor(toast.tone)}
      <div
        class="toast tone-{toast.tone}"
        role={toast.tone === 'error' ? 'alert' : 'status'}
        in:fly={{ y: enterY, duration: enterMs }}
        out:fade={{ duration: exitMs }}
      >
        <span class="ic" aria-hidden="true"><Icon size={15} /></span>
        <span class="msg">{toast.message}</span>
        <button class="dismiss" type="button" aria-label="Dismiss" onclick={() => toastStore.dismiss(toast.id)}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-host {
    position: fixed;
    left: 50%;
    top: var(--space-4);
    transform: translateX(-50%);
    z-index: var(--z-toast, 1200);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    pointer-events: none;
    max-width: min(92vw, 420px);
    -webkit-font-smoothing: antialiased;
  }
  .toast {
    pointer-events: auto;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    /* concentric radius: 8px inner dismiss inside 6px padding → 14px outer */
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    background: var(--surface-3);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    /* layered shadow reads as depth on any backdrop — softer than a hard border alone */
    box-shadow:
      0 1px 2px color-mix(in oklch, black 18%, transparent),
      0 8px 24px color-mix(in oklch, black 26%, transparent);
  }
  .ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* Role tint: a slight wash of the tone colour over the base surface plus a matching border,
     so the card reads its role at a glance while the icon + text still carry it (never colour
     alone). Mixed in oklab — oklch would sweep the hue arc and muddy the green/red washes. */
  .tone-info {
    background: color-mix(in oklab, var(--accent) 10%, var(--surface-3));
    border-color: color-mix(in oklab, var(--accent) 32%, var(--border));
  }
  .tone-info .ic {
    color: var(--accent);
  }
  .tone-success {
    background: color-mix(in oklab, var(--ok) 10%, var(--surface-3));
    border-color: color-mix(in oklab, var(--ok) 32%, var(--border));
  }
  .tone-success .ic {
    color: var(--ok, var(--accent));
  }
  .tone-error {
    background: color-mix(in oklab, var(--live) 12%, var(--surface-3));
    border-color: color-mix(in oklab, var(--live) 38%, var(--border));
  }
  .tone-error .ic {
    color: var(--live-bright);
  }
  .msg {
    min-width: 0;
    font-size: var(--text-sm);
    line-height: 1.35;
    text-wrap: pretty;
  }
  .dismiss {
    /* visible 24px chip, ≥40px hit area via the pseudo-element below */
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: var(--text-faint);
    background: transparent;
    border: 0;
    border-radius: var(--radius-1);
    cursor: pointer;
    transition:
      color var(--dur-120) ease,
      background-color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .dismiss::after {
    content: '';
    position: absolute;
    inset: -8px;
  }
  .dismiss:hover {
    color: var(--text);
    background: var(--surface-inset);
  }
  .dismiss:active {
    scale: 0.96;
  }
  @media (prefers-reduced-motion: reduce) {
    .dismiss {
      transition: none;
    }
    .dismiss:active {
      scale: 1;
    }
  }
</style>
