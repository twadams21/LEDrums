<script lang="ts">
  import { store } from '../store/app-store.svelte';
  import { tapTempo } from './params';

  const transport = $derived(store.project?.composition.transport ?? null);
  const beat = $derived(store.stats?.beat ?? 0);
  // Pulse on each whole beat (drives the indicator).
  const beatPhase = $derived(beat - Math.floor(beat));
  const onBeat = $derived(beatPhase < 0.18);

  let taps = $state<number[]>([]);

  function tap(): void {
    const now = performance.now();
    // Reset the tap window if it has been idle > 2s.
    const next = taps.length && now - taps[taps.length - 1]! > 2000 ? [now] : [...taps, now];
    taps = next.slice(-8);
    if (taps.length >= 4) {
      const bpm = tapTempo(taps);
      if (bpm !== null) store.setTransport({ bpm });
    }
  }

  function nudge(delta: number): void {
    if (!transport) return;
    const bpm = Math.max(20, Math.min(400, Math.round(transport.bpm + delta)));
    store.setTransport({ bpm });
  }

  function setBpm(e: Event): void {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) store.setTransport({ bpm: v });
  }

  function togglePlay(): void {
    if (transport) store.setTransport({ playing: !transport.playing });
  }
</script>

<section class="transport">
  {#if transport}
    <div class="row">
      <button
        class="play"
        class:playing={transport.playing}
        onclick={togglePlay}
        aria-label={transport.playing ? 'Stop' : 'Play'}
      >
        {transport.playing ? '■ Stop' : '▶ Play'}
      </button>

      <div class="beat" class:lit={onBeat} aria-hidden="true"></div>

      <div class="bpm">
        <button class="nudge" onclick={() => nudge(-1)} aria-label="BPM down">−</button>
        <input
          type="number"
          min="20"
          max="400"
          value={Math.round(transport.bpm)}
          onchange={setBpm}
          aria-label="BPM"
        />
        <button class="nudge" onclick={() => nudge(1)} aria-label="BPM up">+</button>
        <span class="unit">BPM</span>
      </div>

      <button class="tap" onclick={tap}>TAP</button>
    </div>
    <div class="meta">
      <span>{transport.beatsPerBar}/4</span>
      <span>bar {(store.stats?.bar ?? 0) + 1}</span>
      <span>beat {(Math.floor(beat) % transport.beatsPerBar) + 1}</span>
      <span class="fps">{store.fps.toFixed(0)} fps</span>
    </div>
  {:else}
    <div class="empty">Transport unavailable — not connected.</div>
  {/if}
</section>

<style>
  .transport {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .play {
    font-weight: 700;
    min-width: 78px;
  }
  .play.playing {
    background: var(--accent-dim);
    border-color: var(--accent);
  }
  .beat {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #1a2230;
    border: 1px solid var(--border);
    transition: background 0.06s, box-shadow 0.06s;
  }
  .beat.lit {
    background: var(--accent);
    box-shadow: 0 0 12px var(--accent);
  }
  .bpm {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .bpm input {
    width: 58px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    font-weight: 700;
  }
  .nudge {
    width: 26px;
    padding: 4px 0;
    font-weight: 700;
  }
  .unit {
    color: var(--text-dim);
    font-size: 11px;
  }
  .tap {
    margin-left: auto;
    font-weight: 700;
    letter-spacing: 1px;
  }
  .meta {
    display: flex;
    gap: 12px;
    color: var(--text-dim);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .meta .fps {
    margin-left: auto;
  }
  .empty {
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
