<script lang="ts">
  /* The Modifier device card: something that changes the light before it. Power (bypass),
     name, the modifier's params, a Mix (dry / wet) amount, and an optional envelope over the
     Effect's life — collapsed until asked for. `effectId` may be `MASTER_CELL`, which addresses
     the section's Master chain (no controls there, so nothing is ever modulated, and there is
     no per-device file save).

     Reorder: the chain row owns drag (ui-strip-chain); the card's menu offers Move left /
     Move right so a reorder is always reachable from the keyboard. */
  import type { effectChain } from '@ledrums/core';
  import { MASTER_CELL, type EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import FaceParamControl from '../../../../../ui/FaceParamControl.svelte';
  import Switch from '../../../../../ui/Switch.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../../../../ui/ContextMenu.svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Download from '@lucide/svelte/icons/download';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import DeviceCard from './DeviceCard.svelte';
  import ParamRows from './ParamRows.svelte';
  import { modifierIcon } from './device-icons';
  import { mappable } from '../../../../map-mode/mappable.svelte';
  import type { MappableSpec } from '../../../../../trigger-lab/map-api';
  import { effectDisplayName } from '../strip-model';
  import {
    DEFAULT_MODIFIER_ENVELOPE,
    MODIFIER_ENVELOPE_PARAMS,
    adsrPath,
    enumLabel,
    isLandscape,
    modifierCategory,
    modifierLabel,
    modifierParams,
    modulatedKeys,
    pct,
    type CardParam,
  } from './card-model';

  interface Props {
    api: EffectsAuthoringApi;
    effectId: string | typeof MASTER_CELL;
    modifier: effectChain.ModifierDevice;
  }

  let { api, effectId, modifier }: Props = $props();

  const isMaster = $derived(effectId === MASTER_CELL);
  const effect = $derived(isMaster ? undefined : api.effectById(effectId));
  const chain = $derived(isMaster ? api.masterChain : (effect?.modifiers ?? []));
  const index = $derived(chain.findIndex((m) => m.uid === modifier.uid));
  const name = $derived(modifierLabel(modifier.modifierId));
  const category = $derived(modifierCategory(modifier.modifierId));
  const params = $derived(modifierParams(modifier.modifierId));
  const landscape = $derived(isLandscape(params.length));
  const modulated = $derived(modulatedKeys(effect, modifier.uid));
  const disabled = $derived(!api.canEdit);
  const envelope = $derived(modifier.envelope);

  // MIDI-map registrations. Master modifiers belong to no Effect, so an InputMapping (which
  // addresses an Effect) cannot reach them: they register nothing and dim in map mode.
  const mapOwner = $derived(effect ? { id: effect.id, label: `${effectDisplayName(effect)} · ${name}` } : null);
  const bypassMap = $derived<MappableSpec | undefined>(
    mapOwner ? { target: { kind: 'bypass', effectId: mapOwner.id, modifierUid: modifier.uid }, kind: 'toggle', label: `${mapOwner.label} · On` } : undefined,
  );
  const mixMap = $derived<MappableSpec | null>(
    mapOwner ? { target: { kind: 'modifierMix', effectId: mapOwner.id, modifierUid: modifier.uid }, kind: 'continuous', label: `${mapOwner.label} · Mix` } : null,
  );
  const mapParam = (p: CardParam): MappableSpec | null =>
    mapOwner
      ? { target: { kind: 'param', effectId: mapOwner.id, device: modifier.uid, param: p.key }, kind: 'continuous', label: `${mapOwner.label} · ${p.label}` }
      : null;

  // View state: whether the envelope section is unfolded. Collapsed by default (S06b).
  let envOpen = $state(false);

  const begin = (): void => api.beginGesture();
  const end = (): void => api.endGesture();

  const menu = $derived<ContextMenuAction[]>([
    { label: 'Move left', icon: ArrowLeft, disabled: disabled || index <= 0, onSelect: () => api.moveModifier(effectId, modifier.uid, index - 1) },
    {
      label: 'Move right',
      icon: ArrowRight,
      disabled: disabled || index < 0 || index >= chain.length - 1,
      onSelect: () => api.moveModifier(effectId, modifier.uid, index + 1),
    },
    ...(isMaster
      ? []
      : [{ label: 'Save to file…', icon: Download, onSelect: () => void api.saveDeviceToFile(effectId, modifier.uid) }]),
    { label: 'Remove', icon: Trash2, danger: true, disabled, onSelect: () => api.removeModifier(effectId, modifier.uid) },
  ]);

  function setEnvelopeOn(on: boolean): void {
    api.setModifierEnvelope(effectId, modifier.uid, on ? { ...DEFAULT_MODIFIER_ENVELOPE } : null);
    if (on) envOpen = true;
  }
</script>

<DeviceCard
  role="modifier"
  icon={modifierIcon(category)}
  title={name}
  eyebrow={isMaster ? `Master${category ? ` · ${enumLabel(category)}` : ''}` : category ? enumLabel(category) : 'Modifier'}
  power={{ on: !modifier.bypass, onToggle: (on) => api.setModifierBypass(effectId, modifier.uid, !on), map: bypassMap }}
  landscape={landscape}
  {disabled}
>
  {#snippet actions()}
    <ContextMenu mode="dropdown" actions={menu} label={`${name} actions`}>
      <span class="menubtn"><Ellipsis size={14} aria-hidden="true" /></span>
    </ContextMenu>
  {/snippet}

  <ParamRows
    {params}
    values={modifier.params}
    {modulated}
    {disabled}
    labelPrefix={name}
    {mapParam}
    onChange={(key, v) => api.setModifierParam(effectId, modifier.uid, key, v)}
    onGestureStart={begin}
    onGestureEnd={end}
  />

  <!-- Mix + envelope: under the params, or (landscape) a column of their own beside them. -->
  <div class="side">
  <div class="mix">
    <span class="mixlabel">Mix</span>
    <span class="mixctl" {@attach mixMap && mappable(mixMap)}>
      <FaceParamControl
        kind="number"
        value={modifier.mix}
        display={pct(modifier.mix)}
        min={0}
        max={1}
        step={0.01}
        {disabled}
        ariaLabel={`${name} mix`}
        onChange={(v) => api.setModifierMix(effectId, modifier.uid, Number(v))}
        onGestureStart={begin}
        onGestureEnd={end}
      />
    </span>
  </div>

  <div class="env" class:on={!!envelope}>
    <div class="envhead">
      <Tooltip text={envOpen ? 'Hide envelope' : 'Show envelope'}>
        <button
          type="button"
          class="envfold"
          aria-expanded={envOpen}
          aria-label={`${name} envelope`}
          onclick={() => (envOpen = !envOpen)}
        >
          <span class="chev" class:open={envOpen}><ChevronRight size={13} aria-hidden="true" /></span>
          <span>Envelope</span>
        </button>
      </Tooltip>
      {#if envelope && !envOpen}
        <svg class="envmini" viewBox="0 0 40 14" aria-hidden="true"><path d={adsrPath(envelope, 40, 14)} /></svg>
      {/if}
      <Switch checked={!!envelope} {disabled} ariaLabel={`${name} envelope on`} onChange={setEnvelopeOn} />
    </div>
    {#if envOpen}
      {#if envelope}
        <svg class="envplot" viewBox="0 0 232 40" preserveAspectRatio="none" aria-hidden="true">
          <path d={adsrPath(envelope, 232, 40)} />
        </svg>
        <ParamRows
          params={MODIFIER_ENVELOPE_PARAMS}
          values={envelope}
          {disabled}
          labelPrefix={`${name} envelope`}
          onChange={(key, v) => api.setModifierEnvelope(effectId, modifier.uid, { ...envelope, [key]: Number(v) })}
          onGestureStart={begin}
          onGestureEnd={end}
        />
      {:else}
        <p class="hint">Off: the modifier runs at its Mix for the whole hit. Turn on to fade it in and out over the Effect's life.</p>
      {/if}
    {/if}
  </div>
  </div>
</DeviceCard>

<style>
  .side {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: none;
    min-width: 0;
  }
  :global(.card.landscape) .side {
    width: 232px;
  }
  .menubtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-2);
    color: var(--text-faint);
    line-height: 0;
  }
  .menubtn:hover {
    background: var(--surface-inset);
    color: var(--ink);
  }

  .mixctl {
    display: inline-flex;
  }
  .mix {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 26px;
    padding-top: var(--space-1_5);
    box-shadow: inset 0 1px 0 0 var(--border-faint);
  }
  .mixlabel {
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--text);
  }

  .env {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    padding-top: var(--space-1_5);
    box-shadow: inset 0 1px 0 0 var(--border-faint);
  }
  .envhead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .envhead :global(.tt-anchor) {
    flex: 1 1 auto;
  }
  .envfold {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    height: 26px;
    padding: 0 var(--space-1) 0 0;
    border: 0;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--text-2xs);
    cursor: pointer;
  }
  .envfold:hover {
    color: var(--ink);
  }
  .envfold:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-ring);
  }
  .env.on .envfold {
    color: var(--text);
  }
  .chev {
    display: inline-flex;
    line-height: 0;
    transition: rotate var(--dur-120) var(--ease-control);
  }
  .chev.open {
    rotate: 90deg;
  }
  .envmini {
    width: 40px;
    height: 14px;
    flex: none;
  }
  .envplot {
    width: 100%;
    height: 40px;
    border-radius: var(--radius-1);
    background: var(--surface-inset);
  }
  .envmini path,
  .envplot path {
    fill: none;
    stroke: var(--role-effect);
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .hint {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: var(--leading-snug);
    color: var(--text-faint);
    text-wrap: pretty;
  }
</style>
