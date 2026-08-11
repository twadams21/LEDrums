<script module lang="ts">
  /* PROTOTYPE (throwaway — see NOTES.md). */
  export type ProtoVariant = 'B' | 'C';
</script>

<script lang="ts">
  /* Floating variant switcher — deliberately NOT in the app's design language
     (high-contrast pill) so it never reads as part of the chrome under review.
     "A" bails out to the real app at `/`; B/C swap the proto shell in place.
     No arrow-key handling: the app's canvases + perform keys own the arrows. */
  let { variant, onSelect }: { variant: ProtoVariant; onSelect: (v: ProtoVariant) => void } = $props();

  const LABELS: Record<ProtoVariant, string> = {
    B: 'Tabbed · Patch Graph in Settings',
    C: 'Tabbed · Settings only (no patch graph)',
  };

  function goCurrent(): void {
    location.href = '/';
  }
</script>

<div class="proto-switcher" role="toolbar" aria-label="Prototype variant">
  <button type="button" class="opt" onclick={goCurrent} title="Open the real app (current layout)">A</button>
  <button
    type="button"
    class="opt"
    class:on={variant === 'B'}
    onclick={() => onSelect('B')}
    title={LABELS.B}
  >B</button>
  <button
    type="button"
    class="opt"
    class:on={variant === 'C'}
    onclick={() => onSelect('C')}
    title={LABELS.C}
  >C</button>
  <span class="lbl">{variant} — {LABELS[variant]}</span>
</div>

<style>
  .proto-switcher {
    position: fixed;
    bottom: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2000;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 6px 6px;
    border-radius: 999px;
    background: #7c3aed;
    color: #fff;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.45);
    font-size: 12px;
    font-family: var(--font-mono, monospace);
  }
  .opt {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 1px solid rgb(255 255 255 / 0.4);
    border-radius: 999px;
    background: transparent;
    color: #fff;
    font-weight: 700;
    cursor: pointer;
  }
  .opt:hover {
    background: rgb(255 255 255 / 0.15);
  }
  .opt.on {
    background: #fff;
    color: #7c3aed;
    border-color: #fff;
  }
  .lbl {
    white-space: nowrap;
    opacity: 0.9;
  }
</style>
