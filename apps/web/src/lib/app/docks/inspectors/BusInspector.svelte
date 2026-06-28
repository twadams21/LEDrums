<script lang="ts">
  /* Voice-bus (layer) editor — polyphony, crossfade, and a live level meter. The header
     and body chrome match the other Inspector panels. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { Bus, Polyphony } from '../../../trigger-lab/sim';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Slider from '../../../ui/Slider.svelte';
  import { POLY_OPTS } from '../../views/node-options';

  let { store, bus }: { store: TriggerLab; bus: Bus } = $props();
</script>

<header class="ihead">
  <div class="titles">
    <h3>{bus.name}</h3>
    <span class="sub">voice bus · layer</span>
  </div>
</header>
<div class="busbody">
  <label class="lblrow">
    <span class="k">Polyphony</span>
    <SegmentedControl value={bus.polyphony} options={POLY_OPTS} onChange={(v) => store.setPolyphony(bus.id, v as Polyphony)} ariaLabel="Polyphony" />
  </label>
  <label class="lblrow">
    <span class="k">Crossfade</span>
    <span class="sld"><Slider min={60} max={2000} step={20} value={bus.crossfadeMs} onChange={(v) => store.setCrossfade(bus.id, v)} format={(v) => `${Math.round(v)}ms`} /></span>
  </label>
  <div class="meterrow">
    <span class="k">Level</span>
    <span class="meter" aria-hidden="true"><span style="transform:scaleX({store.busLevels[bus.id] ?? 0})"></span></span>
  </div>
  <p class="foot">
    {bus.polyphony === 'mono'
      ? 'Mono — a new voice steals + crossfades over the old (looks).'
      : 'Poly — voices stack and decay (transients).'}
  </p>
</div>

<style>
  .ihead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .sub {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .k {
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-size: var(--text-2xs);
  }
  .busbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .lblrow {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    flex: 1;
    min-width: 0;
    justify-content: space-between;
  }
  .sld {
    display: flex;
    flex: 1;
    max-width: 60%;
  }
  .meterrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .meter {
    flex: 1;
    height: 6px;
    background: var(--surface-inset);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    width: 100%;
    transform-origin: left;
    background: linear-gradient(90deg, var(--accent-dim), var(--accent));
    transition: transform 60ms linear;
  }
  .foot {
    margin: 0;
    padding: var(--space-3);
    border-top: 1px solid var(--border-faint);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    .meter span {
      transition: none;
    }
  }
</style>
