<script lang="ts">
  /* Last-heard input badge (S04): a compact "note · velocity · age" confirmation shown
     beside a MIDI/OSC binding — proof the bound input is actually being heard. Pure
     presentational primitive: it renders a view derived by
     `lib/trigger-lab/input-activity`; the store owns the data + age clock. Composes
     StatusDot (pulse on a fresh hit, tone fades live → muted as it ages). Value + age are
     tabular so the badge never reflows as numbers tick. */
  import StatusDot from './StatusDot.svelte';

  let {
    label,
    value,
    age,
    tone = 'muted',
    fresh = false,
    title,
  }: {
    /** Matched identity — MIDI note name ("C4") or OSC address ("/kick"). */
    label: string;
    /** Human value — MIDI velocity ("92") or trimmed OSC arg ("0.75"). */
    value: string;
    /** Compact age — "now" · "3s" · "1m". */
    age: string;
    /** Fresh reads live; muted once it has aged out. */
    tone?: 'live' | 'muted';
    /** Pulse the dot right after a hit. */
    fresh?: boolean;
    title?: string;
  } = $props();
</script>

<span class={['act', `act-${tone}`]} {title}>
  <StatusDot {tone} pulse={fresh} />
  <span class="lab">{label}</span>
  <span class="sep" aria-hidden="true">·</span>
  <span class="val tnum">{value}</span>
  <span class="sep" aria-hidden="true">·</span>
  <span class="age tnum">{age}</span>
</span>

<style>
  .act {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: 1;
    color: var(--text-muted);
    /* Colour eases as the badge ages out; the dot pulse handles the fresh beat. */
    transition-property: color;
    transition-duration: var(--dur-150);
  }
  .lab {
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .act-live .lab {
    color: var(--ink);
  }
  .sep {
    color: var(--text-faint);
  }
  .val {
    color: var(--text-muted);
  }
  .age {
    color: var(--text-faint);
  }
  .tnum {
    font-variant-numeric: tabular-nums;
  }
</style>
