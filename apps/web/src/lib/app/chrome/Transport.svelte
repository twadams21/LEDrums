<script lang="ts">
  /* Shared transport cluster: play/stop · beat dot · bar.beat clock · time
     signature · tempo (slider + tap) · velocity. Owns the tap-tempo logic behind its
     interface (callers just pass the engine store). Built on the lib/ui design system — no bare
     controls. `compact` drops the velocity slider for the tighter Perform bar.

     The bar.beat clock reads the ENGINE's transport (store.beat, streamed in `stats`) — nothing
     in the browser advances a clock of its own, so with the link down the readout shows that it
     is not running rather than ticking on a local timer.

     (A "Stop all" panic control lived here until INIT-01 Decision 3: it only ever stopped the
     retired browser-side sim — there is no stop-all message in the protocol — so connected it
     had always been inert. It comes back with a real engine-side panic.) */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Select from '../../ui/Select.svelte';
  import Slider from '../../ui/Slider.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';

  let { store, compact = false }: { store: TriggerLab; compact?: boolean } = $props();

  const bar = $derived(Math.floor(store.beat / store.beatsPerBar) + 1);
  const beatInBar = $derived(Math.floor(store.beat % store.beatsPerBar) + 1);
  // With no engine there is no clock at all — show that rather than "1.1", which reads as a
  // transport parked at the top of a bar (INIT-01 Decision 3: nothing local advances the beat).
  const clock = $derived(store.engineTransportLive ? `${bar}.${beatInBar}` : '–.–');
  // pulse the beat dot on the leading edge of each whole beat (only when actually running)
  const onBeat = $derived(store.engineTransportLive && store.playing && store.beat - Math.floor(store.beat) < 0.18);

  const BPB_OPTS = [3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `${n}/4` }));

  // tap-tempo: average the last few tap intervals → BPM (clamped to the range).
  let taps = $state<number[]>([]);
  function tap(): void {
    const now = performance.now();
    taps = (taps.length && now - taps[taps.length - 1]! > 2000 ? [now] : [...taps, now]).slice(-8);
    if (taps.length < 2) return;
    let sum = 0;
    for (let i = 1; i < taps.length; i++) sum += taps[i]! - taps[i - 1]!;
    const avg = sum / (taps.length - 1);
    if (avg > 0) store.bpm = Math.max(60, Math.min(200, Math.round(60000 / avg)));
  }
</script>

<div class="transport" class:compact>
  <div class="play">
    <IconButton
      icon={store.playing ? Pause : Play}
      label={store.playing ? 'Stop' : 'Play'}
      variant={store.playing ? 'soft' : 'solid'}
      onclick={() => store.togglePlay()}
    />
    <span class="beatdot" class:lit={onBeat} aria-hidden="true"></span>
    <span class="clock" class:idle={!store.engineTransportLive} title={store.engineTransportLive ? 'Bar.beat (engine transport)' : 'No engine — the transport clock is not running'}>{clock}</span>
    <span class="bpb"><Select value={String(store.beatsPerBar)} options={BPB_OPTS} onChange={(v) => (store.beatsPerBar = Number(v))} ariaLabel="Time signature" /></span>
  </div>

  <label class="field">
    <span class="flabel">bpm</span>
    <span class="sld"><Slider min={60} max={200} bind:value={store.bpm} showValue={false} ariaLabel="Tempo" /></span>
    <b>{store.bpm}</b>
    <button class="tap" type="button" onclick={tap}>TAP</button>
  </label>

  {#if !compact}
    <label class="field">
      <span class="flabel">vel</span>
      <span class="sld sld-sm"><Slider min={0} max={1} step={0.01} bind:value={store.velocity} showValue={false} ariaLabel="Velocity" /></span>
      <b>{Math.round(store.velocity * 100)}</b>
    </label>
  {/if}
</div>

<style>
  .transport {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }
  .play {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .beatdot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    flex: none;
    transition: background-color 60ms ease, box-shadow 60ms ease, border-color 60ms ease;
  }
  .beatdot.lit {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 10px var(--accent);
  }
  .clock {
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    color: var(--accent);
    min-width: 48px;
    font-variant-numeric: tabular-nums;
    transition: color 140ms ease;
  }
  /* No engine, no clock: drop the accent so the readout stops presenting itself as a live value.
     Colour is not the only signal — the digits themselves become "–.–". */
  .clock.idle {
    color: var(--text-disabled);
  }
  .bpb {
    display: inline-flex;
    min-width: 58px;
  }
  .field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .flabel {
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    font-size: var(--text-2xs);
  }
  .sld {
    display: flex;
    width: 96px;
  }
  .sld-sm {
    width: 72px;
  }
  .field b {
    font-family: var(--font-mono);
    color: var(--ink);
    min-width: 26px;
    font-variant-numeric: tabular-nums;
  }
  .tap {
    padding: 3px var(--space-2);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    letter-spacing: var(--tracking-label);
  }
  @media (prefers-reduced-motion: reduce) {
    .beatdot {
      transition: none;
    }
  }
</style>
