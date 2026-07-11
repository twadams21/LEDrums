<script lang="ts">
  /* Play-node editor — the effect header (thumb + name + swap), preset bar (select + apply/save),
     play-mode + layer segments, scope selector + target dropdown, and the per-param controls
     (slider / toggle + optional envelope button). The shared node header (kind selector + remove)
     lives in the parent Inspector. A preset is a snapshot (S39): selecting one forks its params
     onto the node, Apply re-forks (resets local edits), Save captures the node's params as a new
     preset. Params are always node-local — editing one clip never touches another. */
  import type { TriggerLab } from '../../../trigger-lab/store.svelte';
  import type { GraphNode, Scope } from '../../../trigger-lab/sim';
  import type { Hsv } from '@ledrums/core';
  import { busIcon } from '../../views/trigger-node-meta';
  import { MODE_OPTS, SCOPE_OPTS, num, fmt } from '../../views/node-options';
  import EffectThumb from '../../../trigger-lab/EffectThumb.svelte';
  import Slider from '../../../ui/Slider.svelte';
  import Select from '../../../ui/Select.svelte';
  import SegmentedControl from '../../../ui/SegmentedControl.svelte';
  import Toggle from '../../../ui/Toggle.svelte';
  import ColorSwatch from '../../../ui/ColorSwatch.svelte';
  import IconButton from '../../../ui/IconButton.svelte';
  import ModulationParamsSection from './ModulationParamsSection.svelte';
  import Replace from '@lucide/svelte/icons/replace';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import BookmarkPlus from '@lucide/svelte/icons/bookmark-plus';

  let { store, node }: { store: TriggerLab; node: GraphNode } = $props();

  const eff = $derived(store.effectOf(node));
  const live = $derived(store.liveParams(node));

  /** Read a param as a string (enum choice / colour hex), falling back to `d`. */
  const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
  /** Enum value → a friendly Select label ("out" → "Out", "x" → "X"). */
  const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  /** Effects that carry hue + saturation + brightness numeric params get a colour swatch
      that writes through to all three (the picker is UI-only — persistence stays numeric). */
  const COLOR_KEYS = ['hue', 'saturation', 'brightness'] as const;
  const hasColorSwatch = $derived(!!eff && COLOR_KEYS.every((k) => eff.params.some((p) => p.key === k)));
  // A colour param is "modulated" when it's an exposed target with at least one incoming
  // modulation wire (doc 10) — the legacy per-param envelope was folded into these mappings (S35).
  const colorModulated = $derived(hasColorSwatch && COLOR_KEYS.some((k) => store.mappingsFor(node, k).length > 0));

  function applyColor(hsv: Hsv): void {
    store.setParam(node, 'hue', hsv.h);
    store.setParam(node, 'saturation', hsv.s);
    store.setParam(node, 'brightness', hsv.v);
  }
  // Canvas play nodes (D3/D4) get a scene picker; their params render through the SAME generic
  // param loop below (CANVAS_PARAM_SPEC), so there's no special-casing past the picker.
  const isCanvas = $derived((node.playType ?? eff?.playType) === 'canvas');
  const sceneOptions = $derived(store.allCanvasScenes.map((scene) => ({ value: scene.id, label: scene.name })));

  const presetOptions = $derived(eff ? store.presetsForEffect(eff.id).map((p) => ({ value: p.id, label: p.name })) : []);
  // Store-bound layer options stay reactive over the live buses.
  const LAYER_OPTS = $derived(store.buses.map((b) => ({ value: b.id, label: b.name, icon: busIcon[b.id] })));

  /** Options for the scope-target dropdown, derived from the current scope. */
  const targetOptions = $derived.by(() => {
    const infos = store.kitDrumInfos;
    if (node.scope === 'drum') {
      return infos.map((d) => ({ value: d.id, label: d.label }));
    }
    if (node.scope === 'hoop') {
      return infos.flatMap((d) =>
        Array.from({ length: d.hoopCount }, (_, i) => ({
          value: `${d.id}#${i}`,
          label: `${d.label} · Hoop ${i}`,
        })),
      );
    }
    return [];
  });
</script>

{#if eff}
  <header class="ihead">
    <div class="thumb"><EffectThumb params={live} generatorId={eff.generatorId} labModel={store.labModel} w={72} h={40} /></div>
    <div class="titles">
      <h3>{eff.name}</h3>
      <span class="sub">{node.scope}</span>
    </div>
    <IconButton icon={Replace} label="Change effect" variant="soft" size={14} onclick={() => store.openGallery(node)} />
  </header>

  {#if isCanvas}
    <div class="sceneRow">
      <span class="k">Scene</span>
      <Select
        value={node.canvasScene ?? ''}
        options={sceneOptions}
        onChange={(v) => store.setCanvasScene(node, v)}
        placeholder="Choose scene"
        ariaLabel="Canvas scene"
        class="sceneSelect"
      />
      <IconButton
        icon={BookmarkPlus}
        label="New canvas scene"
        variant="soft"
        size={14}
        onclick={() => store.setCanvasScene(node, store.createCanvasScene())}
      />
    </div>
  {/if}

  <div class="bar">
    <label class="lblrow">
      <span class="k">Preset</span>
      <Select value={node.presetId} options={presetOptions} onChange={(v) => store.selectPreset(node, v)} ariaLabel="Preset" />
    </label>
    <div class="presetActions">
      <IconButton icon={RotateCcw} label="Apply preset — reset params to it" variant="soft" size={14} onclick={() => store.applyPreset(node)} />
      <IconButton icon={BookmarkPlus} label="Save params as a new preset" variant="soft" size={14} onclick={() => store.saveNodeAsPreset(node)} />
    </div>
  </div>

  <div class="seg2">
    <SegmentedControl value={node.mode} options={MODE_OPTS} onChange={(v) => store.setMode(node, v as 'oneshot' | 'loop' | 'hold')} ariaLabel="Play mode" />
    <SegmentedControl value={store.busOf(node)} options={LAYER_OPTS} onChange={(v) => store.setBus(node, v)} ariaLabel="Layer" />
  </div>

  <div class="scoperow">
    <span class="k">Scope</span>
    <SegmentedControl
      value={node.scope}
      options={SCOPE_OPTS}
      onChange={(v) => store.setScope(node, v as Scope)}
      ariaLabel="Render scope"
    />
  </div>

  {#if node.scope !== 'kit'}
    <div class="targetrow">
      <span class="k">Target</span>
      <Select
        value={node.targetId ?? ''}
        options={targetOptions}
        onChange={(v) => store.setTargetId(node, v || undefined)}
        placeholder="Auto (triggering drum)"
        ariaLabel="Scope target"
      />
    </div>
  {/if}

  <div class="params">
    {#if hasColorSwatch}
      <div class="prow">
        <span class="plabel">Colour</span>
        <ColorSwatch
          hue={num(live['hue'], 0)}
          saturation={num(live['saturation'], 1)}
          brightness={num(live['brightness'], 1)}
          modulated={colorModulated}
          onChange={applyColor}
          ariaLabel="Effect colour"
        />
      </div>
    {/if}
    {#each eff.params as spec (spec.key)}
      <div class="prow">
        <span class="plabel">{spec.label}</span>
        {#if spec.kind === 'number'}
          <Slider
            value={num(live[spec.key], 0)}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            format={(v) => fmt(spec, v)}
            onChange={(v) => store.setParam(node, spec.key, v)}
            ariaLabel={spec.label}
          />
        {:else if spec.kind === 'enum'}
          <Select
            value={str(live[spec.key], spec.options?.[0] ?? '')}
            options={(spec.options ?? []).map((o) => ({ value: o, label: titleCase(o) }))}
            onChange={(v) => store.setParam(node, spec.key, v)}
            ariaLabel={spec.label}
            class="paramsel"
          />
        {:else}
          <!-- bool → Toggle. `color` specs map (fixtures.mapParamSpec) but their inspector
               control — the write-through swatch — is owned by S19; no effect declares one yet. -->
          <Toggle pressed={live[spec.key] === true} onChange={(v) => store.setParam(node, spec.key, v)} ariaLabel={spec.label} class="boolcell" />
        {/if}
      </div>
    {/each}
  </div>

  <ModulationParamsSection {store} {node} />

  <p class="foot">
    Edits stay on this clip. Save them as a preset to reuse, or Apply the preset to reset. Applies on the next hit.
  </p>
{:else}
  <div class="kindbody">
    <p class="hint">This play node has no effect yet — change its kind above, or pick an effect from the canvas.</p>
  </div>
{/if}

<style>
  .ihead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .thumb {
    line-height: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-0_5);
    flex: none;
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
  .bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .lblrow {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    flex: 1;
    min-width: 0;
  }
  .k {
    color: var(--text-muted);
    font-weight: 500;
    font-size: var(--text-2xs);
    white-space: nowrap;
  }
  .presetActions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
  }
  .seg2 {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .seg2 :global(.seg) {
    flex: 1;
  }
  .seg2 :global(.seg-row) {
    display: flex;
    width: 100%;
  }
  .seg2 :global(.seg-btn) {
    flex: 1;
    text-align: center;
    justify-content: center;
  }
  .scoperow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .sceneRow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .sceneRow :global(.sceneSelect),
  .sceneRow :global(.select-trigger) {
    flex: 1;
    min-width: 0;
  }
  .targetrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .targetrow :global(.select-trigger) {
    flex: 1;
    min-width: 0;
  }
  .params {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .prow {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
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
  /* Enum Select fills the middle (value) column, like the scope-target select. */
  .prow :global(.paramsel) {
    width: 100%;
    min-width: 0;
  }
  .foot {
    margin: 0;
    padding: var(--space-3);
    border-top: 1px solid var(--border-faint);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .kindbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
</style>
