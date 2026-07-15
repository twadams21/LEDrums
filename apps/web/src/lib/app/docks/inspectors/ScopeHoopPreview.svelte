<script lang="ts">
  import { getThumbProjection, THUMB_COLS, THUMB_ROWS, type DotTable } from '../../../trigger-lab/thumb-projection';
  import { hoopLabel } from './scope-inspector';

  type Props = {
    label: string;
    hoopCount: number;
    selectedHoops: number[];
    whole: boolean;
    onSelectHoop: (event: MouseEvent, hoop: number) => void;
    w?: number;
    h?: number;
  };

  let { label, hoopCount, selectedHoops, whole, onSelectHoop, w = 236, h = 150 }: Props = $props();

  let canvas = $state<HTMLCanvasElement>();
  let hovered = $state<number | null>(null);

  const visibleHoops = $derived(Math.min(Math.max(hoopCount, 0), THUMB_ROWS));
  const active = $derived(new Set(selectedHoops.filter((h) => h >= 1 && h <= visibleHoops))); // hoops 1-based (A1)
  const cssProjection = $derived(getThumbProjection(w, h, false));
  const rowBands = $derived.by(() => {
    const bands: Array<{ top: number; height: number }> = [];
    const table = cssProjection.main;
    for (let row = 0; row < visibleHoops; row++) {
      let min = Infinity;
      let max = -Infinity;
      for (let col = 0; col < THUMB_COLS; col++) {
        const i = row * THUMB_COLS + col;
        const y = table.hy[i]!;
        const ry = table.ry[i]!;
        const lw = table.lw[i]!;
        min = Math.min(min, y - ry - lw * 1.15);
        max = Math.max(max, y + ry + lw * 1.15);
      }
      bands[row] = {
        top: Math.max(0, (min / h) * 100),
        height: Math.min(100, ((max - min) / h) * 100),
      };
    }
    return bands;
  });

  function isOn(hoop: number): boolean {
    return whole || active.has(hoop);
  }

  function segmentColor(row: number, col: number, intensity: number): [number, number, number] {
    const phase = col / THUMB_COLS;
    const magenta = (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    const cyan = (Math.sin(phase * Math.PI * 2 + Math.PI * 0.72) + 1) / 2;
    const rowLift = row / Math.max(1, visibleHoops - 1);
    return [
      Math.round((36 + magenta * 178 + rowLift * 26) * intensity),
      Math.round((54 + cyan * 122 + (1 - magenta) * 22) * intensity),
      Math.round((185 + magenta * 54 + cyan * 34) * intensity),
    ];
  }

  function strokeSegment(ctx: CanvasRenderingContext2D, table: DotTable, i: number, color: [number, number, number], alpha: number, scale: number): void {
    const [r, g, b] = color;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth = table.lw[i]! * scale;
    ctx.beginPath();
    ctx.ellipse(table.hx[i]!, table.hy[i]!, table.rx[i]!, table.ry[i]!, 0, table.a0[i]!, table.a1[i]!);
    ctx.stroke();
  }

  $effect(() => {
    const cv = canvas;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);
    const dw = Math.round(w * dpr);
    const dh = Math.round(h * dpr);
    cv.width = dw;
    cv.height = dh;

    const proj = getThumbProjection(dw, dh, false);
    const table = proj.main;
    const selected = active;
    const hover = hovered;
    const count = visibleHoops;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0a0d12';
    ctx.fillRect(0, 0, dw, dh);
    if (proj.baseLayer) ctx.drawImage(proj.baseLayer as CanvasImageSource, 0, 0);

    ctx.globalCompositeOperation = 'lighter';
    for (let row = 0; row < count; row++) {
      // row is a 0-based geometry index; selected/hover carry 1-based hoop numbers (A1).
      const rowOn = whole || selected.has(row + 1);
      const rowHover = hover === row + 1;
      if (!rowOn && !rowHover) continue;
      const intensity = rowOn ? 1 : 0.44;
      for (let col = 0; col < THUMB_COLS; col++) {
        const i = row * THUMB_COLS + col;
        const shade = table.shade[i]!;
        const color = segmentColor(row, col, intensity * shade);
        if (rowOn) strokeSegment(ctx, table, i, color, 0.24, 2.7);
        strokeSegment(ctx, table, i, color, rowOn ? 0.92 : 0.34, rowOn ? 1 : 0.86);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  });
</script>

<div class="scope-thumb" aria-label={`${label} hoop selector`}>
  <canvas bind:this={canvas} style="width:{w}px; aspect-ratio:{w} / {h};"></canvas>
  <div class="hit-layer" aria-hidden="false">
    {#each Array.from({ length: visibleHoops }, (_, i) => i + 1) as hoop (hoop)}
      {@const band = rowBands[hoop - 1] ?? { top: 0, height: 25 }}
      <button
        type="button"
        class:selected={isOn(hoop)}
        style={`--top:${band.top.toFixed(2)}%; --height:${band.height.toFixed(2)}%;`}
        aria-pressed={isOn(hoop)}
        aria-label={`${label} ${hoopLabel(hoop)}`}
        onpointerenter={() => (hovered = hoop)}
        onpointerleave={() => (hovered = null)}
        onclick={(event) => onSelectHoop(event, hoop)}
      >
        <span>{hoop}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .scope-thumb {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    min-height: 178px;
    overflow: hidden;
    background: #0a0d12;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.055),
      inset 0 0 44px rgba(13, 22, 34, 0.72);
  }
  canvas {
    display: block;
    max-width: calc(100% - var(--space-4));
    height: auto;
    border-radius: var(--radius-1);
  }
  .hit-layer {
    position: absolute;
    inset: var(--space-2);
  }
  button {
    position: absolute;
    left: 9%;
    right: 9%;
    top: var(--top);
    height: max(var(--height), 28%);
    min-height: 40px;
    color: var(--text-faint);
    background: transparent;
    border: 0;
    border-radius: var(--radius-1);
    cursor: pointer;
  }
  button:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -2px;
  }
  button span {
    position: absolute;
    right: var(--space-2);
    top: 50%;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    background: color-mix(in oklch, var(--surface) 86%, transparent);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-pill);
  }
  button:hover span,
  button.selected span {
    color: var(--ink);
    border-color: color-mix(in oklch, var(--role-output) 45%, var(--border));
  }
  @media (prefers-reduced-motion: reduce) {
    button {
      transition: none;
    }
  }
</style>
