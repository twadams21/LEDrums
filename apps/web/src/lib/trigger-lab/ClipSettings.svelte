<script lang="ts">
  /* Clip (instance) settings: pick a preset, edit parameters, assign per-param
     envelopes, and link/unlink to the shared preset. Bits UI Dialog. Throwaway. */
  import EffectThumb from './EffectThumb.svelte';
  import Slider from '../ui/Slider.svelte';
  import Select from '../ui/Select.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Toggle from '../ui/Toggle.svelte';
  import Dialog from '../ui/Dialog.svelte';
  import X from '@lucide/svelte/icons/x';
  import Spline from '@lucide/svelte/icons/spline';
  import type { ParamSpec, ParamValue } from './sim';
  import type { TriggerLab } from './store.svelte';

  let { store }: { store: TriggerLab } = $props();

  const block = $derived(store.settingsBlock);
  const eff = $derived(block ? store.effectOf(block) : undefined);
  const live = $derived(block ? store.liveParams(block) : {});
  const open = $derived(!!block && block.kind === 'play' && !!eff);
  const presetOptions = $derived(eff ? store.presetsForEffect(eff.id).map((p) => ({ value: p.id, label: p.name })) : []);

  const LINK_OPTS = [
    { value: 'instance', label: 'Instance' },
    { value: 'linked', label: 'Linked' },
  ];

  function num(v: ParamValue | undefined, d: number): number {
    return typeof v === 'number' ? v : d;
  }
  function fmt(spec: ParamSpec, v: ParamValue | undefined): string {
    if (typeof v === 'number') return `${spec.step && spec.step < 1 ? v.toFixed(2) : Math.round(v)}${spec.unit ?? ''}`;
    return v ? 'on' : 'off';
  }
</script>

<Dialog {open} onClose={() => store.closeSettings()} title={eff?.name ?? 'Clip'} class="dlg-settings">
  {#if block && block.kind === 'play' && eff}
    <header class="shead">
      <div class="thumb"><EffectThumb pattern={eff.pattern} params={live} w={84} h={46} /></div>
      <div class="titles">
        <h2>{eff.name}</h2>
        <span class="sub">{eff.pattern} · {eff.busId} · {eff.scope}</span>
      </div>
      <button class="swap" onclick={() => store.openGallery(block)}>Change effect</button>
      <button class="close" onclick={() => store.closeSettings()} aria-label="Close"><X size={16} aria-hidden="true" /></button>
    </header>

    <div class="bar">
      <span class="preset">
        <span class="plead">Preset</span>
        <Select value={block.presetId} options={presetOptions} onChange={(v) => store.selectPreset(block, v)} ariaLabel="Preset" />
      </span>
      <span class="spacer"></span>
      <SegmentedControl
        value={block.linked ? 'linked' : 'instance'}
        options={LINK_OPTS}
        onChange={(v) => {
          if ((v === 'linked') !== block.linked) store.toggleLink(block);
        }}
        ariaLabel="Instance or linked preset"
      />
    </div>

    <div class="params">
      {#each eff.params as spec (spec.key)}
        {@const enveloped = store.isEnveloped(block, spec.key)}
        <div class="prow">
          <span class="plabel">{spec.label}</span>
          {#if spec.kind === 'number'}
            <Slider
              value={num(live[spec.key], 0)}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              disabled={enveloped}
              format={(v) => (enveloped ? 'swept' : fmt(spec, v))}
              onChange={(v) => store.setParam(block, spec.key, v)}
              ariaLabel={spec.label}
            />
          {:else}
            <Toggle
              pressed={live[spec.key] === true}
              onChange={(v) => store.setParam(block, spec.key, v)}
              ariaLabel={spec.label}
              class="boolcell"
            />
          {/if}
          {#if spec.envable}
            <button class="envbtn" class:on={enveloped} onclick={() => store.openEnv(block, spec.key)} title="Assign envelope">
              <Spline size={13} aria-hidden="true" />
              {store.envKind(block, spec.key)}
            </button>
          {:else}
            <span class="envspace"></span>
          {/if}
        </div>
      {/each}
    </div>

    <p class="foot">
      {block.linked ? 'Linked — edits change the shared preset everywhere it’s used.' : 'Instance — edits stay on this clip. Link to sync across songs/sections.'}
      Changes apply on the next hit.
    </p>
  {/if}
</Dialog>

<style>
  :global(.dlg-settings) {
    width: min(460px, 94vw);
  }
  .shead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .thumb {
    line-height: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: 2px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
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
  .swap {
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
  }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    margin-right: calc(var(--space-2) * -1);
    background: transparent;
    border: none;
    color: var(--text-faint);
    border-radius: var(--radius-2);
    transition: color 120ms ease, background-color 120ms ease, scale 120ms ease;
  }
  .close:hover {
    color: var(--ink);
    background: var(--surface-inset);
  }
  .close:active {
    scale: 0.96;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-faint);
  }
  .preset {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .preset :global(.sel) {
    min-width: 8rem;
  }
  .spacer {
    flex: 1;
  }
  .params {
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    overflow: auto;
    min-height: 0;
  }
  .prow {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }
  .plabel {
    font-size: var(--text-xs);
    color: var(--text);
  }
  .prow :global(.boolcell) {
    justify-self: start;
  }
  .envbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px var(--space-2);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    text-transform: capitalize;
    transition: color 120ms ease, border-color 120ms ease, background-color 120ms ease, scale 120ms ease;
  }
  .envbtn:active {
    scale: 0.96;
  }
  .envbtn.on {
    color: var(--ink);
    border-color: color-mix(in oklch, var(--accent) 55%, transparent);
    background: var(--accent-soft);
  }
  .envspace {
    width: 1px;
  }
  .foot {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-faint);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
</style>
