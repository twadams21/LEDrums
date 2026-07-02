<script lang="ts">
  /* Space, radii, elevation, z-index and control sizing — the shape of the shell. */
  import CopyChip from '../CopyChip.svelte';

  const space = [
    ['--space-0_5', 2],
    ['--space-1', 4],
    ['--space-2', 8],
    ['--space-3', 12],
    ['--space-4', 16],
    ['--space-5', 24],
    ['--space-6', 32],
    ['--space-7', 48],
    ['--space-8', 64],
  ] as const;

  const radii = [
    ['--radius-1', '3px — chips, tiny controls'],
    ['--radius-2', '5px — buttons, inputs'],
    ['--radius-3', '8px — cards-within-panels, node cards'],
    ['--radius-4', '12px — styleguide blocks'],
    ['--radius-pill', '999px — pills'],
    ['--radius-card', '0px — panels/cards (LOCKED square; the one soften-everything knob)'],
  ] as const;

  const shadows = [
    ['--shadow-1', 'Resting cards / controls'],
    ['--shadow-2', 'Popovers, dropdowns'],
    ['--shadow-3', 'Modals'],
  ] as const;

  const zTiers = [
    ['--z-base', '0'],
    ['--z-docked', '10'],
    ['--z-sticky', '20'],
    ['--z-dropdown', '30'],
    ['--z-overlay', '40'],
    ['--z-modal-backdrop', '50'],
    ['--z-modal', '60'],
    ['--z-toast', '70'],
    ['--z-tooltip', '80'],
  ] as const;
</script>

<section class="block" id="space">
  <div class="block-head">
    <h2>Space · shape · elevation</h2>
    <p>4px base grid. Square panel corners are a locked decision — soften only small controls.</p>
  </div>

  <div class="subgrid">
    <div class="sub">
      <h3>Space — 4px base</h3>
      <div class="space-list">
        {#each space as [v, px] (v)}
          <div class="space-row">
            <CopyChip text={v} />
            <span class="bar" style="width: {px}px"></span>
            <code>{px}px</code>
          </div>
        {/each}
      </div>
    </div>

    <div class="sub">
      <h3>Radii</h3>
      <div class="radius-list">
        {#each radii as [v, label] (v)}
          <div class="radius-row">
            <span class="radius-chip" style="border-radius: var({v})"></span>
            <div class="radius-meta">
              <CopyChip text={v} />
              <span class="rlabel">{label}</span>
            </div>
          </div>
        {/each}
      </div>
      <h3 class="later">Control sizing</h3>
      <div class="ctl-row">
        <span class="ctl-demo" style="width: var(--control-icon-size); height: var(--control-icon-size)"></span>
        <CopyChip text="--control-icon-size" />
        <span class="rlabel">30px — the canonical icon-button square</span>
      </div>
    </div>

    <div class="sub">
      <h3>Elevation</h3>
      <div class="shadow-row">
        {#each shadows as [v, label] (v)}
          <div class="shadow-card" style="box-shadow: var({v})">
            <CopyChip text={v} />
            <span class="rlabel">{label}</span>
          </div>
        {/each}
      </div>
      <h3 class="later">Overlay scrim</h3>
      <div class="ctl-row">
        <span class="scrim-demo"></span>
        <CopyChip text="--overlay" />
        <span class="rlabel">behind Dialogs + Drawers</span>
      </div>
    </div>

    <div class="sub">
      <h3>Semantic z-index</h3>
      <div class="z-list">
        {#each zTiers as [v, val] (v)}
          <div class="z-row">
            <CopyChip text={v} />
            <code>{val}</code>
          </div>
        {/each}
      </div>
    </div>
  </div>
</section>

<style>
  .subgrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-5) var(--space-6);
  }
  .sub {
    min-width: 0;
  }
  h3 {
    font-size: var(--text-sm);
    color: var(--text);
    margin-bottom: var(--space-3);
  }
  .later {
    margin-top: var(--space-4);
  }
  .space-list,
  .radius-list,
  .z-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .space-row {
    display: grid;
    grid-template-columns: 110px 1fr auto;
    align-items: center;
    gap: var(--space-3);
  }
  .bar {
    height: 12px;
    background: var(--accent-dim);
    border-radius: 1px;
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .radius-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .radius-chip {
    flex: none;
    width: 40px;
    height: 32px;
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
  }
  .radius-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .rlabel {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .ctl-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .ctl-demo {
    flex: none;
    display: inline-block;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
  }
  .shadow-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--space-4);
  }
  .shadow-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--surface-2);
    border-radius: var(--radius-3);
  }
  .scrim-demo {
    flex: none;
    width: 40px;
    height: 32px;
    border-radius: var(--radius-2);
    border: 1px solid var(--border-faint);
    background:
      linear-gradient(var(--overlay), var(--overlay)),
      repeating-conic-gradient(oklch(0.4 0 0) 0% 25%, oklch(0.3 0 0) 0% 50%) 0 0 / 12px 12px;
  }
  .z-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--border-faint);
  }
</style>
