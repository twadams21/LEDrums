<script lang="ts">
  /* Output status pill. Today the only signal the web app has for "is real LED
     output running" is the engine-link state (Art-Net arming is server-side — see
     the redesign plan's follow-ups), so the pill is link-derived: open ⇒ LIVE
     (the server engine is driving output), connecting ⇒ SYNC, offline ⇒ LOCAL
     (local sim preview only). A true armed/dry-run/off control is a later slice.

     Renders on the shared `lib/ui/StatusPill` (S1.4): live→`live` tone, connecting→
     `warn` + pulsing dot, offline→`muted`. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import type { StatusTone } from '../../ui/StatusDot.svelte';

  let { store }: { store: TriggerLab } = $props();

  const tone = $derived<StatusTone>(
    store.link === 'open' ? 'live' : store.link === 'connecting' ? 'warn' : 'muted',
  );
  const label = $derived(
    store.link === 'open' ? 'LIVE' : store.link === 'connecting' ? 'SYNC' : 'LOCAL',
  );
  const title = $derived(
    store.link === 'open'
      ? 'Server engine connected — driving LED output'
      : store.link === 'connecting'
        ? 'Connecting to the server engine…'
        : 'No engine link — local preview only',
  );
</script>

<StatusPill {tone} {label} pulse={store.link === 'connecting'} {title} />
