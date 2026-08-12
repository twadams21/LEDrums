<script lang="ts">
  /* LEARN — arm a field to bind the next input it hears.

     The house "learn the next hit" affordance, extracted from TriggerSourceInspector once
     the global-control bindings needed the same 15 lines. It is a TOGGLE, not a one-shot:
     pressing it while armed disarms, so a mis-armed field is escapable without binding
     something wrong.

     Stateless by design — the caller owns the arm (a store learn target), because two
     different fields may be armed against two different arms at once (a control's MIDI
     and OSC Learn buttons are independent) and only the store can say which.

     `aria-pressed` carries the armed state to assistive tech; the label change alone
     would not. */
  import Radio from '@lucide/svelte/icons/radio';

  type Props = {
    /** Whether this field is currently listening for its next input. */
    armed: boolean;
    onclick: () => void;
    disabled?: boolean;
    /** Accessible name — say WHAT is being learned when several sit on one screen. */
    ariaLabel?: string;
  };

  let { armed, onclick, disabled = false, ariaLabel }: Props = $props();
</script>

<button
  type="button"
  class="learn"
  class:active={armed}
  {disabled}
  aria-pressed={armed}
  aria-label={ariaLabel}
  onclick={(e) => {
    e.preventDefault();
    onclick();
  }}
>
  <Radio size={13} aria-hidden="true" />
  {armed ? 'Listening' : 'Learn'}
</button>

<style>
  .learn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 29px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 600;
    white-space: nowrap;
    transition-property: border-color, color;
    transition-duration: var(--dur-120);
    transition-timing-function: var(--ease-control);
  }
  .learn:hover:not(:disabled),
  .learn.active {
    border-color: var(--accent);
    color: var(--ink);
  }
  .learn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .learn:disabled {
    opacity: 0.45;
  }
  /* Armed is a LIVE state — it pulses so a listening field is findable at a glance
     across a dialog of otherwise identical rows. */
  .learn.active :global(svg) {
    color: var(--accent);
    animation: learn-pulse 1.4s ease-in-out infinite;
  }
  @keyframes learn-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .learn {
      transition: none;
    }
    .learn.active :global(svg) {
      animation: none;
    }
  }
</style>
