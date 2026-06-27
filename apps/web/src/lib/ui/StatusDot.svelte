<script module lang="ts">
  /* The status tones shared by StatusDot and StatusPill. Each maps to a colour
     token: ok -> --ok, warn -> --warn, live -> --live, accent -> --accent,
     muted -> --text-muted (the neutral default). */
  export type StatusTone = 'ok' | 'warn' | 'live' | 'accent' | 'muted';
</script>

<script lang="ts">
  /* The coloured status dot used inside StatusPill (and reusable on its own).
     `tone` picks the colour token; `pulse` adds the slow blink used for
     in-progress states (e.g. connecting / SYNC). The blink is dropped under
     prefers-reduced-motion. */
  let {
    tone = 'muted',
    pulse = false,
    class: klass,
  }: { tone?: StatusTone; pulse?: boolean; class?: string } = $props();
</script>

<span class={['dot', `dot-${tone}`, { pulse }, klass]} aria-hidden="true"></span>

<style>
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    flex: none;
    color: var(--text-muted);
  }
  .dot-ok {
    color: var(--ok);
  }
  .dot-warn {
    color: var(--warn);
  }
  .dot-live {
    color: var(--live);
    box-shadow: 0 0 8px color-mix(in oklch, var(--live) 70%, transparent);
  }
  .dot-accent {
    color: var(--accent);
  }
  .dot-muted {
    color: var(--text-muted);
  }
  .dot.pulse {
    animation: status-dot-pulse 0.9s steps(2, jump-none) infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .dot.pulse {
      animation: none;
    }
  }
  @keyframes status-dot-pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
