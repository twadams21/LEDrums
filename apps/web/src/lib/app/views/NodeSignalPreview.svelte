<script lang="ts">
  /* Node-face signal preview for a modulation SOURCE node (doc 10, S38):
       · envelope → shape sparkline + a phase cursor sweeping one replayed hit
       · lfo      → waveform trace + a moving phase cursor
       · cc       → a live value bar + a numeric MIDI readout (0..127)

     All three draw on the shared {@link SignalFace} (one rAF ticker, viewport-gated,
     reduced-motion → a single static frame). The signal itself is sampled through the core
     functions via `signal-preview.ts` — this component only maps that geometry onto the
     canvas with theme-token colours. The SIGNAL moves; the chrome stays still. */
  import { voice } from '@ledrums/core';
  import SignalFace from '../../trigger-lab/SignalFace.svelte';
  import { envelopeTrace, formatCcReadout, lfoTrace, type SignalTrace } from '../../trigger-lab/signal-preview';
  import { readThemeTokens } from '../../ui/theme-tokens';

  interface Props {
    kind: 'envelope' | 'lfo' | 'cc';
    env?: voice.Envelope;
    lfo?: voice.LfoSettings;
    bpm?: number;
    /** Live 0..1 CC level getter (reads the sim/engine CC table), sampled each frame. */
    ccValue?: () => number;
    w?: number;
    h?: number;
  }
  let { kind, env, lfo, bpm = 120, ccValue, w = 56, h = 32 }: Props = $props();

  let root = $state<HTMLElement>();
  // Theme-aware canvas colours via the shared token reader — fixed fallbacks, never the
  // reactive `c` (the self-referential-$effect P0 the helper exists to make unwritable).
  const FALLBACK_COLOURS = { signal: '#7c9cff', ink: '#e6e9f0', grid: '#3a4056' };
  const TOKENS = { signal: '--role-modulation', ink: '--ink', grid: '--border-faint' };
  let c = $state({ ...FALLBACK_COLOURS });
  $effect(() => {
    c = readThemeTokens(root, TOKENS, FALLBACK_COLOURS);
  });

  let ccReadout = $state('0');
  const PAD = 3;

  function drawTrace(g: CanvasRenderingContext2D, t: SignalTrace): void {
    const iw = w - PAD * 2;
    const ih = h - PAD * 2;
    const X = (x: number): number => PAD + x * iw;
    const Y = (y: number): number => PAD + (1 - y) * ih; // y=1 → top

    // baseline (signal floor) — a faint rule so a low/zero signal still reads
    g.strokeStyle = c.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(PAD, Y(0));
    g.lineTo(w - PAD, Y(0));
    g.stroke();

    // the signal shape
    g.strokeStyle = c.signal;
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    g.beginPath();
    t.shape.forEach((p, i) => (i === 0 ? g.moveTo(X(p.x), Y(p.y)) : g.lineTo(X(p.x), Y(p.y))));
    g.stroke();

    // phase cursor: a faint vertical rule + a bright dot riding the curve
    const cx = X(t.cursor);
    g.strokeStyle = c.signal;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.moveTo(cx, PAD);
    g.lineTo(cx, h - PAD);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = c.ink;
    g.beginPath();
    g.arc(cx, Y(t.value), 2.2, 0, Math.PI * 2);
    g.fill();
  }

  function drawBar(g: CanvasRenderingContext2D, value: number): void {
    const iw = w - PAD * 2;
    const ih = h - PAD * 2;
    const barH = Math.min(ih, 10);
    const y = PAD + (ih - barH) / 2;
    // track
    g.fillStyle = c.grid;
    g.fillRect(PAD, y, iw, barH);
    // filled level
    g.fillStyle = c.signal;
    g.fillRect(PAD, y, iw * value, barH);
  }

  const draw = (g: CanvasRenderingContext2D, tMs: number): void => {
    if (kind === 'cc') {
      const v = ccValue ? ccValue() : 0;
      drawBar(g, v);
      ccReadout = formatCcReadout(v);
      return;
    }
    const trace =
      kind === 'envelope'
        ? envelopeTrace(env ?? voice.defaultEnvelope('decay'), tMs)
        : lfoTrace(lfo ?? voice.defaultLfoSettings(), tMs, bpm);
    drawTrace(g, trace);
  };

  const label = $derived(
    kind === 'envelope'
      ? 'Envelope signal preview'
      : kind === 'lfo'
        ? 'LFO signal preview'
        : 'CC live value',
  );
</script>

<div class="preview" bind:this={root} class:cc={kind === 'cc'}>
  <SignalFace {draw} {w} {h} ariaLabel={label} />
  {#if kind === 'cc'}
    <span class="readout" aria-hidden="true">{ccReadout}</span>
  {/if}
</div>

<style>
  .preview {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    line-height: 0;
  }
  /* CC readout: a compact tabular MIDI value beside the level bar */
  .readout {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    line-height: 1;
    min-width: 2ch;
    text-align: right;
  }
</style>
