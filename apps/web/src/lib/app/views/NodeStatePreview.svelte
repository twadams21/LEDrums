<script lang="ts">
  /* Node-face STATE preview for the gating / routing kinds (wave-4 locked decision 1 —
     full preview coverage): a static face that reads the node's configured state, plus a
     trigger-driven response when the open graph fires (`fireAt` = store.selectedGraphFireAt,
     flash geometry from the pure `firePulse` / `firePick` / `delayProgress` helpers).

       · chance   → a donut arc filled to p; fires flash the arc
       · toggle   → a power ring that flips filled/hollow on each fire (display-only
                    approximation of the engine's alternation — resets on mount)
       · delay    → a wait bar that fills across the configured delay after a fire, then
                    flashes when the (deferred) children fire
       · sequence → one dot per wired child; the cursor advances a step per fire
       · all      → a 1→N fan; every line flashes together on a fire
       · random   → a 1→N fan; ONE line flashes per fire (deterministic from the epoch)
       · switch   → gate: a threshold bar with the cutoff marker; other modes: the fan
       · modifier → an S-curve "transform" glyph; flashes on a fire

     Display-only: never reads engine state (AGENTS.md determinism stays intact). Drawn on
     the shared SignalFace (one rAF ticker, viewport-gated, reduced-motion static frame).
     rAF-sampled getters null-guard `node` — a node can be deleted a frame before the
     ticker fires (HANDOFF cross-cutting #1). The per-fire step/flip $effects READ only
     `fireAt` and WRITE only local counters — never self-referential. */
  import { voice } from '@ledrums/core';
  import type { GraphNode } from '../../trigger-lab/sim';
  import SignalFace from '../../trigger-lab/SignalFace.svelte';
  import { delayProgress, firePick, firePulse } from '../../trigger-lab/signal-preview';
  import { readThemeTokens } from '../../ui/theme-tokens';

  interface Props {
    node: GraphNode | null;
    /** Wired (default-port) child count — sizes the fan / sequence dots. */
    childCount?: number;
    bpm?: number;
    /** The open graph's fire epoch (`performance.now()` ms), or null until it fires. */
    fireAt?: number | null;
    /** The kind's tint token (e.g. '--role-mod') — the face draws in the node's colour. */
    tintToken?: string;
    w?: number;
    h?: number;
  }
  let { node, childCount = 0, bpm = 120, fireAt = null, tintToken = '--accent', w = 56, h = 32 }: Props = $props();

  let root = $state<HTMLElement>();
  const FALLBACK_COLOURS = { signal: '#9ae600', ink: '#e6e9f0', grid: '#3a4056' };
  const TOKENS = $derived({ signal: tintToken, ink: '--ink', grid: '--border-faint' });
  let c = $state({ ...FALLBACK_COLOURS });
  $effect(() => {
    c = readThemeTokens(root, TOKENS, FALLBACK_COLOURS);
  });

  // Display-only per-fire counters (sequence step / toggle flip). The effect reads
  // `fireAt` only and ASSIGNS the rune from a plain shadow counter — `fires += 1` would
  // read the rune it writes (the self-referential class, convergent here but banned) and
  // cost a wasted re-run per fire.
  let fires = $state(0);
  let fireCount = 0;
  let lastEpoch: number | null = null;
  $effect(() => {
    const epoch = fireAt;
    if (epoch != null && epoch !== lastEpoch) {
      lastEpoch = epoch;
      fires = ++fireCount;
    }
  });

  const PAD = 3;

  function fan(g: CanvasRenderingContext2D, n: number, litIndex: number | null, pulse: number): void {
    const count = Math.max(1, n);
    const x0 = PAD + 4;
    const x1 = w - PAD - 4;
    const cy = h / 2;
    g.fillStyle = c.grid;
    g.beginPath();
    g.arc(x0, cy, 2.4, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < count; i++) {
      const y = count === 1 ? cy : PAD + 4 + (i * (h - 2 * (PAD + 4))) / (count - 1);
      const lit = pulse > 0 && (litIndex === null || litIndex === i);
      g.strokeStyle = lit ? c.signal : c.grid;
      g.globalAlpha = lit ? 0.35 + 0.65 * pulse : 1;
      g.lineWidth = lit ? 1.6 : 1;
      g.beginPath();
      g.moveTo(x0, cy);
      g.lineTo(x1, y);
      g.stroke();
      g.fillStyle = lit ? c.signal : c.grid;
      g.beginPath();
      g.arc(x1, y, 2, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  function donut(g: CanvasRenderingContext2D, p: number, pulse: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - PAD - 1;
    g.lineWidth = 3;
    g.strokeStyle = c.grid;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = c.signal;
    g.globalAlpha = 0.65 + 0.35 * pulse;
    g.beginPath();
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }

  function bar(g: CanvasRenderingContext2D, fill: number, marker: number | null, pulse: number): void {
    const iw = w - PAD * 2;
    const barH = 6;
    const y = (h - barH) / 2;
    g.fillStyle = c.grid;
    g.fillRect(PAD, y, iw, barH);
    if (fill > 0) {
      g.fillStyle = c.signal;
      g.globalAlpha = 0.75 + 0.25 * pulse;
      g.fillRect(PAD, y, iw * fill, barH);
      g.globalAlpha = 1;
    }
    if (marker !== null) {
      g.fillStyle = c.ink;
      g.fillRect(PAD + iw * marker - 1, y - 2, 2, barH + 4);
    }
    if (pulse > 0) {
      g.strokeStyle = c.signal;
      g.globalAlpha = pulse;
      g.strokeRect(PAD - 0.5, y - 2.5, iw + 1, barH + 5);
      g.globalAlpha = 1;
    }
  }

  function dots(g: CanvasRenderingContext2D, n: number, active: number, pulse: number): void {
    const count = Math.max(2, n);
    const iw = w - 2 * (PAD + 4);
    const cy = h / 2;
    for (let i = 0; i < count; i++) {
      const x = PAD + 4 + (count === 1 ? iw / 2 : (i * iw) / (count - 1));
      const isActive = i === active;
      g.fillStyle = isActive ? c.signal : c.grid;
      g.beginPath();
      g.arc(x, cy, isActive ? 3 + pulse * 1.5 : 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }

  function powerRing(g: CanvasRenderingContext2D, on: boolean, pulse: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - PAD - 2;
    g.lineWidth = 2;
    g.strokeStyle = on ? c.signal : c.grid;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    if (on) {
      g.fillStyle = c.signal;
      g.globalAlpha = 0.35 + 0.65 * Math.max(pulse, 0.4);
      g.beginPath();
      g.arc(cx, cy, r - 3.5, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  function sCurve(g: CanvasRenderingContext2D, pulse: number): void {
    const x0 = PAD + 2;
    const x1 = w - PAD - 2;
    const y0 = h - PAD - 3;
    const y1 = PAD + 3;
    g.strokeStyle = pulse > 0 ? c.signal : c.grid;
    g.globalAlpha = pulse > 0 ? 0.45 + 0.55 * pulse : 1;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x0, y0);
    g.bezierCurveTo(w * 0.55, y0, w * 0.45, y1, x1, y1);
    g.stroke();
    g.globalAlpha = 1;
  }

  const draw = (g: CanvasRenderingContext2D, tMs: number): void => {
    const n = node; // null-guard: rAF can outlive the node by a frame
    if (!n) return;
    const now = tMs; // the shared ticker broadcasts performance.now() — same clock as fireAt
    const pulse = firePulse(fireAt, now);
    switch (n.kind) {
      case 'chance':
        donut(g, n.p, pulse);
        break;
      case 'toggle':
        powerRing(g, fires % 2 === 1, pulse);
        break;
      case 'delay': {
        const delayMs = voice.computeDelayMs(n.delayMode, n.ms, n.division, bpm);
        const progress = delayProgress(fireAt, now, delayMs);
        const arrival = fireAt != null ? firePulse(fireAt + delayMs, now) : 0;
        bar(g, progress, null, arrival);
        break;
      }
      case 'sequence':
        dots(g, Math.max(childCount, 2), childCount > 0 ? (fires + childCount - 1) % childCount : 0, pulse);
        break;
      case 'all':
        fan(g, Math.max(childCount, 2), null, pulse);
        break;
      case 'random':
        fan(g, Math.max(childCount, 2), fireAt != null ? firePick(fireAt, Math.max(childCount, 2)) : null, pulse);
        break;
      case 'switch':
        if (n.on === 'value' && (n.valueMode ?? 'gate') === 'gate') bar(g, 0, n.threshold ?? 0.5, pulse);
        else fan(g, Math.max(childCount, 2), null, pulse);
        break;
      case 'modifier':
        sCurve(g, pulse);
        break;
      default:
        break;
    }
  };
</script>

<div class="preview" bind:this={root}>
  <SignalFace {draw} {w} {h} ariaLabel={node ? `${node.kind} state preview` : 'state preview'} />
</div>

<style>
  .preview {
    display: inline-flex;
    align-items: center;
    line-height: 0;
  }
</style>
