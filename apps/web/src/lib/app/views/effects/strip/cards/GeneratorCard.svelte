<script lang="ts">
  /* The Generator device card: what makes the light. Kind picker (the eleven Generators as
     icons), a Style Select, a live thumbnail of the source, then the chosen Style's params
     from core `generatorParamSpec`. Splice / Slice have no Styles: they show their slots
     editor and their own settings. Scene picks a canvas scene.

     Every edit goes through the authoring api; param drags are gesture-bracketed so one drag
     is one undo step. Params a control is driving carry the modulated badge. */
  import { listCanvasScenes, type effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import EffectThumb from '../../../../../trigger-lab/EffectThumb.svelte';
  import Select from '../../../../../ui/Select.svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import IconButton from '../../../../../ui/IconButton.svelte';
  import Download from '@lucide/svelte/icons/download';
  import DeviceCard from './DeviceCard.svelte';
  import ParamRows from './ParamRows.svelte';
  import SlotsEditor from './SlotsEditor.svelte';
  import SpliceFace from './SpliceFace.svelte';
  import { GENERATOR_ICON } from './device-icons';
  import { effectDisplayName } from '../strip-model';
  import type { MappableSpec } from '../../../../../trigger-lab/map-api';
  import {
    SCENE_PARAM,
    currentStyle,
    generatorKinds,
    generatorLabel,
    generatorParams,
    paramsLandscape,
    isSlotted,
    modulatedKeys,
    styleOptions,
    thumbSource,
    type CardParam,
  } from './card-model';

  interface Props {
    api: EffectsAuthoringApi;
    effect: effectChain.Effect;
  }

  let { api, effect }: Props = $props();

  const kinds = generatorKinds();
  const device = $derived(effect.generator);
  const label = $derived(generatorLabel(device.kind));
  const styles = $derived(styleOptions(device.kind));
  const style = $derived(currentStyle(device));
  const params = $derived(generatorParams(device));
  // Splice and Slice have their own sectioned face, always laid out left to right; others go landscape when long.
  const spliceFace = $derived(device.kind === 'splice' || device.kind === 'slice');
  const landscape = $derived(spliceFace || paramsLandscape(params));
  const thumb = $derived(thumbSource(device));
  const modulated = $derived(modulatedKeys(effect, 'generator'));
  const disabled = $derived(!api.canEdit);
  const slotted = $derived(isSlotted(device.kind));
  const effectName = $derived(effectDisplayName(effect));

  /** MIDI-map: a CC / OSC value drives the param live across its range. */
  const mapParam = (p: CardParam): MappableSpec => ({
    target: { kind: 'param', effectId: effect.id, device: 'generator', param: p.key },
    kind: 'continuous',
    label: `${effectName} · ${p.label}`,
  });

  const sceneOptions = $derived(device.kind === 'scene' ? listCanvasScenes().map((s) => ({ value: s.id, label: s.name })) : []);
  const sceneId = $derived.by(() => {
    const v = device.params[SCENE_PARAM];
    return typeof v === 'string' && v ? v : (sceneOptions[0]?.value ?? '');
  });

  // Roving focus over the kind buttons: arrows move focus, Enter / Space picks. Arrows do
  // NOT pick — a pick swaps the Generator (one undo step, params reset), so browsing with the
  // keyboard must not author on every step.
  const activeIndex = $derived(Math.max(0, kinds.findIndex((k) => k.kind === device.kind)));
  let focusIndex = $state<number | null>(null);
  const tabIndexOf = (i: number): number => (i === (focusIndex ?? activeIndex) ? 0 : -1);

  function onKindKey(e: KeyboardEvent, i: number): void {
    const cols = 6;
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    let next: number | null = null;
    if (e.key in step) next = Math.min(kinds.length - 1, Math.max(0, i + step[e.key]!));
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = kinds.length - 1;
    if (next === null) return;
    e.preventDefault();
    focusIndex = next;
    const group = (e.currentTarget as HTMLElement).closest('.kinds');
    group?.querySelectorAll<HTMLButtonElement>('button.kind')[next]?.focus();
  }

  function pickKind(kind: effectChain.GeneratorKind): void {
    if (kind !== device.kind) api.setGenerator(effect.id, kind);
  }
</script>

<DeviceCard
  role="generator"
  icon={GENERATOR_ICON[device.kind]}
  title={label}
  eyebrow="Generator"
  width={272}
  {landscape}
  {disabled}
  selected={api.selectedDevice?.kind === 'stage' && api.selectedDevice.effectId === effect.id && api.selectedDevice.stage === 'generator'}
  onSelect={() => api.selectDevice({ kind: 'stage', effectId: effect.id, stage: 'generator' })}
  onDeselect={() => api.selectDevice(null)}
>
  {#snippet actions()}
    <IconButton icon={Download} label="Save generator to file…" size={14} onclick={() => void api.saveDeviceToFile(effect.id, 'generator')} />
  {/snippet}

  <!-- The lead column: kind, preview, style, slots. Landscape, the params run in columns beside it. -->
  <div class="lead">
  <div class="kinds" role="group" aria-label="Generator kind" data-keyboard-owner="roving">
    {#each kinds as k, i (k.kind)}
      {@const Icon = GENERATOR_ICON[k.kind]}
      <Tooltip text={k.description ? `${k.label} — ${k.description}` : k.label}>
        <button
          type="button"
          class="kind"
          class:active={k.kind === device.kind}
          aria-pressed={k.kind === device.kind}
          aria-label={k.label}
          tabindex={tabIndexOf(i)}
          {disabled}
          onfocus={() => (focusIndex = i)}
          onkeydown={(e) => onKindKey(e, i)}
          onclick={() => pickKind(k.kind)}
        >
          <Icon size={15} aria-hidden="true" />
        </button>
      </Tooltip>
    {/each}
  </div>

  {#if !slotted}
    <div class="preview" class:missing={!thumb}>
      {#if thumb}
        <EffectThumb generatorId={thumb.generatorId} params={thumb.params} w={254} h={72} />
      {:else}
        <span>This style can't be previewed</span>
      {/if}
    </div>
  {/if}

  {#if styles.length > 1}
    <div class="field">
      <span class="flabel">Style</span>
      <Select
        value={style}
        options={styles}
        segment={false}
        {disabled}
        ariaLabel={`${label} style`}
        onChange={(v) => api.setGenerator(effect.id, device.kind, v)}
        class="fsel"
      />
    </div>
  {/if}

  {#if device.kind === 'scene'}
    <div class="field">
      <span class="flabel">Scene</span>
      <Select
        value={sceneId}
        options={sceneOptions}
        segment={false}
        {disabled}
        placeholder="No scenes"
        ariaLabel="Canvas scene"
        onChange={(v) => api.setGeneratorParam(effect.id, SCENE_PARAM, v)}
        class="fsel"
      />
    </div>
  {/if}

  {#if slotted}
    <SlotsEditor {api} {effect} />
  {/if}
  </div>

  {#if spliceFace}
    <SpliceFace {api} {effect} {modulated} {mapParam} />
  {:else}
    <ParamRows
      {params}
      values={device.params}
      {modulated}
      {disabled}
      labelPrefix={label}
      {mapParam}
      onChange={(key, v) => api.setGeneratorParam(effect.id, key, v)}
      onPatch={(patch) => api.setGeneratorParams(effect.id, patch)}
      onGestureStart={() => api.beginGesture()}
      onGestureEnd={() => api.endGesture()}
    />
  {/if}
</DeviceCard>

<style>
  .kinds {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 2px;
    flex: none;
  }
  .kinds :global(.tt-anchor) {
    display: flex;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-faint);
    cursor: pointer;
    line-height: 0;
  }
  /* instant hover — no transition (S06 UI conventions) */
  .kind:hover {
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .kind.active {
    color: var(--role-content);
    background: color-mix(in oklch, var(--role-content) 16%, var(--surface-inset));
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--role-content) 55%, transparent);
  }
  .kind:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .kind:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-ring);
  }

  .lead {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: none;
    min-width: 0;
  }
  /* Landscape: the lead keeps the portrait card's inner width as its own column. */
  :global(.card.landscape) .lead {
    width: 256px;
  }
  .preview {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    height: 72px;
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    outline: 1px solid rgba(255, 255, 255, 0.1);
    outline-offset: -1px;
    overflow: hidden;
  }
  .preview.missing {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }

  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .flabel {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .field :global(.fsel) {
    width: 168px;
  }
</style>
