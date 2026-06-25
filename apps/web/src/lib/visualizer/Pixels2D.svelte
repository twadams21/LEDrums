<script lang="ts">
  /* Flat 2D pixel map of the live output, one row per drum (real pixels from the
     composited frame). Diagnostic counterpart to the 3D stage. Per-layer
     breakdown arrives when the engine streams per-layer frames (slice 4). */
  import type { SerializedModel } from '../ws/protocol-types';

  interface Props {
    model: SerializedModel | null;
    frame: Uint8Array | null;
  }
  let { model, frame }: Props = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let wrap = $state<HTMLDivElement | null>(null);
  let w = $state(0);
  let h = $state(0);

  $effect(() => {
    const el = wrap;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      w = Math.floor(entry.contentRect.width);
      h = Math.floor(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Resize backing store on dimension change.
  $effect(() => {
    const c = canvas;
    if (!c || w === 0 || h === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = h * dpr;
  });

  // Redraw on every frame / model / size change.
  $effect(() => {
    const c = canvas;
    const m = model;
    const f = frame;
    if (!c || w === 0 || h === 0 || !m || m.drums.length === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padX = 12;
    const padY = 10;
    const labelW = 58;
    const gap = 8;
    const rows = m.drums.length;
    const rowH = Math.max(8, Math.min(34, (h - padY * 2 - gap * (rows - 1)) / rows));

    ctx.font = '600 10px ui-monospace, "Geist Mono Variable", monospace';
    ctx.textBaseline = 'middle';

    m.drums.forEach((drum, di) => {
      const y = padY + di * (rowH + gap);
      ctx.fillStyle = '#97a0ad';
      ctx.fillText(drum.label.slice(0, 8), padX, y + rowH / 2);

      const x0 = padX + labelW;
      const availW = w - x0 - padX;
      const cw = drum.pixelCount > 0 ? availW / drum.pixelCount : availW;
      for (let i = 0; i < drum.pixelCount; i++) {
        const pi = (drum.pixelStart + i) * 3;
        let r = 18;
        let g = 22;
        let b = 30;
        if (f && pi + 2 < f.length) {
          r = f[pi]!;
          g = f[pi + 1]!;
          b = f[pi + 2]!;
        }
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x0 + i * cw, y, Math.max(1, cw + 0.6), rowH);
      }
    });
  });

  const hasModel = $derived(!!model && model.drums.length > 0);
</script>

<div class="px2d" bind:this={wrap}>
  {#if hasModel}
    <canvas bind:this={canvas} style="width:{w}px;height:{h}px"></canvas>
  {:else}
    <div class="empty">
      <span>2D pixel map</span>
      <small>Connect the engine to see the live per-drum output.</small>
    </div>
  {/if}
</div>

<style>
  .px2d {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  canvas {
    display: block;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    text-align: center;
    padding: var(--space-4);
  }
  .empty span {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .empty small {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    max-width: 26ch;
  }
</style>
