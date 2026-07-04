<script lang="ts">
  /* Output status pill — the app's ambient "is real LED output running?" surface.
     Derives from the server's OutputStatus (arming state, packetsSent, lastError;
     broadcast in every `stats` message and on `state`) combined with the WS link
     state, via the pure `deriveOutputPill` truth table.

     Link state alone is not enough: Art-Net/sACN send is fire-and-forget, so the
     socket can be open and green while output is actually failing (lastError set,
     packets 0). The pill must not lie "LIVE" then — see output-pill.ts for the full
     state table + the "LIVE is impossible unless armed & transmitting" invariant.

     Renders on the shared `lib/ui/StatusPill` (tokens + reduced-motion handled there). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import { deriveOutputPill } from './output-pill';

  let { store }: { store: TriggerLab } = $props();

  // S49: while the adopted controller runs a built-in test pattern it ignores the live output
  // stream, so the pill drops from LIVE to a loud amber TEST for the whole takeover.
  const view = $derived(deriveOutputPill(store.link, store.output, store.controllerTakeover !== null));
</script>

<StatusPill tone={view.tone} label={view.label} pulse={view.pulse} title={view.title} />
