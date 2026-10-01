<script lang="ts">
  /* The Splice Generator's settings in the graph-era Splice inspector's sections and words (Tim,
     2026-10-01: "bring it back as close to that version, if not exactly the same … with the new
     layout"), one column each, left to right:
       SPLICE        — how many splices, per what, where the cut sits, how uneven, how soft.
       MOVE AROUND   — how the light acts WITHIN that area: chase, spin or stagger, at a rate.
       MOVE THROUGH  — where the light is SENT: drum to drum, hoop to hoop, splice to splice, each
                       in an order you drag or pick — and what waiting parts do.
       BRIGHTNESS ENVELOPE — attack, curve, sustain, decay.
     The Splices rows sit in the card's lead column with the kind picker. Not carried over, because
     the Effect owns them now: the old "On / Target" scope (the Target card), and the envelope's
     Layer / Play / Hit again (the Effect's Retrigger and the Trigger card's length). */
  import type { Snippet } from 'svelte';
  import { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import type { MappableSpec } from '../../../../../trigger-lab/map-api';
  import SegmentedControl from '../../../../../ui/SegmentedControl.svelte';
  import Select from '../../../../../ui/Select.svelte';
  import OrderList from '../../../../../ui/OrderList.svelte';
  import EasePicker from '../../../../../ui/EasePicker.svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import Info from '@lucide/svelte/icons/info';
  import ParamRows from './ParamRows.svelte';
  import { drumHoopCount } from '../strip-model';
  import { toCardParam, type CardParam, type ParamValue } from './card-model';
  import {
    AROUND_LAYER,
    OFFSET_OPTIONS,
    RATE_KEYS,
    RATE_OPTIONS,
    SPLICE_AROUND_ORDER_OPTS,
    SPLICE_CHASE_HINTS,
    SPLICE_CHASE_OPTS,
    SPLICE_DIRECTION_OPTS,
    SPLICE_MOTION_MODE_HINTS,
    SPLICE_MOTION_MODE_OPTS,
    SPLICE_ORDER_OPTS,
    SPLICE_PARTITION_OPTS,
    SPLICE_WAIT_MODE_HINTS,
    SPLICE_WAIT_MODE_OPTS,
    THROUGH_DRUM_LAYER,
    NO_DIVISION,
    aroundLabel,
    effectiveOrder,
    sequenceOf,
    showAround,
    showThroughDrum,
    showThroughKit,
    slotsAtCount,
    spliceCountOf,
    targetDrumCount,
    throughKitLayer,
    timingActive,
    timingPatch,
    timingValue,
    type ThroughLayer,
    type TimingKeys,
  } from './splice-face';

  interface Props {
    api: EffectsAuthoringApi;
    effect: effectChain.Effect;
    modulated?: ReadonlySet<string>;
    mapParam?: (param: CardParam) => MappableSpec | null;
  }

  let { api, effect, modulated, mapParam }: Props = $props();

  const params = $derived(effect.generator.params);
  const disabled = $derived(!api.canEdit);

  // The spec's own params (range, step, unit), relabelled in the inspector's words.
  const SPEC = new Map(effectChain.spliceGeneratorParamSpec('splice').map((s) => [s.key, toCardParam(s)]));
  const P = (key: string, over: Partial<CardParam> = {}): CardParam => ({ ...SPEC.get(key)!, ...over });

  const str = (key: string, fallback: string): string => (typeof params[key] === 'string' ? (params[key] as string) : fallback);
  const num = (key: string, fallback: number): number => (typeof params[key] === 'number' ? (params[key] as number) : fallback);

  const partition = $derived(str('partition', 'hoop'));
  const chase = $derived(str('chase', 'off'));
  const motionMode = $derived(str('motionMode', 'restart'));
  const waitMode = $derived(str('waitMode', 'lit'));
  const jitter = $derived(num('jitter', 0));
  const seed = $derived(Math.trunc(num('seed', 1)) >>> 0);

  // ---- writes: every change is one undo step (several params fold into one gesture) ----------
  function set(key: string, value: ParamValue): void {
    api.setGeneratorParam(effect.id, key, value);
  }
  function setMany(patch: Record<string, ParamValue>): void {
    api.beginGesture();
    for (const [k, v] of Object.entries(patch)) api.setGeneratorParam(effect.id, k, v);
    api.endGesture();
  }
  /** The band count, with the Splices rows grown (cycling) or trimmed to match. */
  function setCount(n: number): void {
    const count = spliceCountOf({ count: n });
    api.beginGesture();
    api.setSpliceSlots(effect.id, slotsAtCount(effect.generator.slots ?? [], count));
    api.setGeneratorParam(effect.id, 'count', count);
    api.endGesture();
  }
  function onRow(key: string, value: ParamValue): void {
    if (key === 'count') setCount(Number(value));
    else set(key, value);
  }
  const gesture = { onGestureStart: () => api.beginGesture(), onGestureEnd: () => api.endGesture() };

  // ---- rows per section -----------------------------------------------------------------------
  const spliceRows = $derived([
    P('count', { label: 'Splices' }),
    P('rotationDeg', { label: 'Rotate' }),
    P('jitter', { label: 'Random lengths', percent: true, unit: '%' }),
    P('smudge', { label: 'Smudge', percent: true, unit: '%' }),
    ...(jitter > 0 ? [P('seed', { label: 'Seed' })] : []),
  ]);
  const envelopeLead = [P('attackMs', { label: 'Attack' })];
  const envelopeTail = [P('holdMs', { label: 'Sustain' }), P('releaseMs', { label: 'Decay' })];

  // ---- MOVE THROUGH: which layers, over what -----------------------------------------------------
  const drums = $derived(api.gridRows.filter((r) => r.id !== 'kit').map((r) => ({ id: r.id, label: r.label })));
  const hoops = $derived.by(() => {
    const t = effect.target;
    const one = t?.kind === 'select' && t.drums.length === 1 ? t.drums[0]!.drumId : null;
    const count = one ? drumHoopCount(api, one) : Math.max(0, ...drums.map((d) => drumHoopCount(api, d.id)));
    return Array.from({ length: Math.max(1, count) }, (_, i) => ({ id: String(i + 1), label: `Hoop ${i + 1}` }));
  });
  const kitDrums = $derived(targetDrumCount(effect.target ?? { kind: 'kit' }, drums.length));

  interface LayerView {
    label: string;
    info: string;
    aria: string;
    layer: ThroughLayer;
    items: { id: string; label: string }[] | null;
    orderOptions: { value: string; label: string }[];
  }
  const layers = $derived.by((): LayerView[] => {
    const out: LayerView[] = [];
    if (showThroughKit(partition, kitDrums)) {
      out.push({
        label: 'THROUGH KIT',
        info: 'Sends the light from drum to drum across the kit, one step apart, in the order below. With THROUGH DRUM as well, it spirals.',
        aria: 'Through kit',
        layer: throughKitLayer(partition),
        items: drums,
        orderOptions: SPLICE_ORDER_OPTS,
      });
    }
    if (showThroughDrum(partition)) {
      out.push({
        label: 'THROUGH DRUM',
        info: 'Sends the light from hoop to hoop up each drum, one step apart, in the order below.',
        aria: 'Through drum',
        layer: THROUGH_DRUM_LAYER,
        items: hoops,
        orderOptions: SPLICE_ORDER_OPTS,
      });
    }
    if (showAround(waitMode)) {
      out.push({
        label: aroundLabel(partition),
        info: 'Brings each splice on after the one before it, one step apart, in the order below.',
        aria: 'Around',
        layer: AROUND_LAYER,
        items: null,
        orderOptions: SPLICE_AROUND_ORDER_OPTS,
      });
    }
    return out;
  });

  const ORDER_INFO = 'Drag the chips into the order they light, or press ← and → on one. The patterns below are one-click starting orders.';

  function ordered(view: LayerView): { id: string; label: string }[] {
    if (!view.items) return [];
    const byId = new Map(view.items.map((item) => [item.id, item]));
    const pattern = str(view.layer.pattern, 'up');
    return effectiveOrder(view.items.map((i) => i.id), sequenceOf(params, view.layer.sequence), pattern, seed).map((id) => byId.get(id)!);
  }
  /** A pattern REPLACES a dragged order, so it clears the sequence in the same step. */
  function setPattern(layer: ThroughLayer, order: string): void {
    setMany(layer.sequence ? { [layer.pattern]: order, [layer.sequence]: '' } : { [layer.pattern]: order });
  }
  function msParam(keys: TimingKeys, label: string): CardParam {
    return P(keys.ms, { label, min: keys === RATE_KEYS ? 10 : 0 });
  }
</script>

{#snippet head(title: string, info?: string)}
  <div class="sechead">
    <h4 class="sectitle">{title}</h4>
    {#if info}
      <Tooltip text={info} side="top">
        <span class="info" aria-label={`About ${title.toLowerCase()}`}><Info size={11} aria-hidden="true" /></span>
      </Tooltip>
    {/if}
  </div>
{/snippet}

{#snippet field(label: string, info: string | undefined, control: Snippet)}
  <div class="field">
    <span class="flabel">
      {label}
      {#if info}
        <Tooltip text={info} side="top">
          <span class="info" aria-label={`About ${label}`}><Info size={11} aria-hidden="true" /></span>
        </Tooltip>
      {/if}
    </span>
    {@render control()}
  </div>
{/snippet}

{#snippet timing(label: string, info: string | undefined, aria: string, keys: TimingKeys, options: { value: string; label: string }[], fallback: string)}
  {#snippet control()}
    <Select
      value={timingValue(params, keys, fallback)}
      {options}
      segment={false}
      {disabled}
      ariaLabel={`${aria} division`}
      onChange={(v) => setMany(timingPatch(v, keys))}
      class="fsel"
    />
  {/snippet}
  {@render field(label, info, control)}
  {#if str(keys.mode, 'beats') === 'time'}
    <ParamRows params={[msParam(keys, 'Time')]} values={params} {modulated} {disabled} labelPrefix={aria} {mapParam} onChange={onRow} {...gesture} />
  {/if}
{/snippet}

<div class="sections">
  <!-- SPLICE -->
  <section class="sec" aria-label="Splice">
    {@render head('Splice')}
    <ParamRows params={spliceRows.slice(0, 1)} values={params} {modulated} {disabled} labelPrefix="Splice" {mapParam} onChange={onRow} {...gesture} />
    {#snippet per()}
      <SegmentedControl value={partition} options={SPLICE_PARTITION_OPTS} {disabled} ariaLabel="Splice partition" onChange={(v) => set('partition', v)} />
    {/snippet}
    {@render field('Per', undefined, per)}
    <ParamRows params={spliceRows.slice(1)} values={params} {modulated} {disabled} labelPrefix="Splice" {mapParam} onChange={onRow} {...gesture} />
  </section>

  <!-- MOVE AROUND -->
  <section class="sec" aria-label="Move around">
    {@render head('Move around')}
    {#snippet motion()}
      <SegmentedControl value={chase} options={SPLICE_CHASE_OPTS} {disabled} ariaLabel="Splice motion" onChange={(v) => set('chase', v)} />
    {/snippet}
    {@render field('Motion', SPLICE_CHASE_HINTS[chase], motion)}
    {#if chase !== 'off'}
      {#snippet onHit()}
        <SegmentedControl value={motionMode} options={SPLICE_MOTION_MODE_OPTS} {disabled} ariaLabel="Splice motion mode" onChange={(v) => set('motionMode', v)} />
      {/snippet}
      {@render field('On each hit', SPLICE_MOTION_MODE_HINTS[motionMode], onHit)}
      {@render timing('Rate', undefined, 'Splice rate', RATE_KEYS, RATE_OPTIONS, '1/8')}
      {#if chase === 'stagger'}
        <ParamRows params={[P('incrementPx', { label: 'Increment' })]} values={params} {modulated} {disabled} labelPrefix="Splice" {mapParam} onChange={onRow} {...gesture} />
      {/if}
      {#snippet direction()}
        <SegmentedControl
          value={num('direction', 1) < 0 ? '-1' : '1'}
          options={SPLICE_DIRECTION_OPTS}
          {disabled}
          ariaLabel="Splice direction"
          onChange={(v) => set('direction', v === '-1' ? -1 : 1)}
        />
      {/snippet}
      {@render field('Direction', undefined, direction)}
    {/if}
  </section>

  <!-- MOVE THROUGH -->
  <section class="sec" aria-label="Move through">
    {@render head('Move through')}
    {#snippet mode()}
      <SegmentedControl value={waitMode} options={SPLICE_WAIT_MODE_OPTS} {disabled} ariaLabel="Splice move through mode" onChange={(v) => set('waitMode', v)} />
    {/snippet}
    {@render field('Mode', SPLICE_WAIT_MODE_HINTS[waitMode], mode)}
    {#each layers as view (view.aria)}
      <div class="layer">
        {@render timing(view.label, view.info, view.aria, view.layer.keys, OFFSET_OPTIONS, NO_DIVISION)}
        {#if timingActive(params, view.layer.keys)}
          {#if view.items && view.layer.sequence}
            {@const seq = sequenceOf(params, view.layer.sequence)}
            {#snippet order()}
              <div class="order">
                <OrderList
                  items={ordered(view)}
                  {disabled}
                  ariaLabel={`${view.aria} order`}
                  onReorder={(ids) => set(view.layer.sequence!, ids.join(','))}
                />
                <!-- No pattern lit while a dragged order is in charge: the chips ARE the order. -->
                <SegmentedControl
                  value={seq.length ? '' : str(view.layer.pattern, 'up')}
                  options={view.orderOptions}
                  {disabled}
                  ariaLabel={`${view.aria} order pattern`}
                  onChange={(v) => setPattern(view.layer, v)}
                />
              </div>
            {/snippet}
            {@render field('Order', ORDER_INFO, order)}
          {:else}
            {#snippet orderSelect()}
              <Select
                value={str(view.layer.pattern, 'up')}
                options={view.orderOptions}
                segment={false}
                {disabled}
                ariaLabel={`${view.aria} order`}
                onChange={(v) => setPattern(view.layer, v)}
                class="fsel"
              />
            {/snippet}
            {@render field('Order', undefined, orderSelect)}
          {/if}
        {/if}
      </div>
    {/each}
  </section>

  <!-- BRIGHTNESS ENVELOPE -->
  <section class="sec" aria-label="Brightness envelope">
    {@render head('Brightness envelope', 'How long the lights stay up after a hit: attack up, sustain at full, then decay away.')}
    <ParamRows params={envelopeLead} values={params} {modulated} {disabled} labelPrefix="Splice" {mapParam} onChange={onRow} {...gesture} />
    {#snippet curve()}
      <EasePicker
        value={{ fn: str('attackEaseFn', 'linear') as never, dir: str('attackEaseDir', 'in') as never }}
        {disabled}
        ariaLabel="Splice attack curve"
        onChange={(v) => setMany({ attackEaseFn: v.fn, attackEaseDir: v.dir })}
      />
    {/snippet}
    {@render field('Curve', 'A linear attack reads as brightening too fast — an ease-in curve swells more evenly.', curve)}
    <ParamRows params={envelopeTail} values={params} {modulated} {disabled} labelPrefix="Splice" {mapParam} onChange={onRow} {...gesture} />
  </section>
</div>

<style>
  .sections {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    flex: none;
    /* Wide enough for the inspector's longest segments (Restart · Continuous · Latched, the order
       patterns) without clipping. */
    width: 280px;
    min-width: 0;
  }
  /* A hairline between sections, so the columns read as the inspector's groups. */
  .sec + .sec {
    padding-left: var(--space-4);
    margin-left: calc(-1 * var(--space-2));
    box-shadow: inset 1px 0 0 var(--border-faint);
  }
  .sechead {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 20px;
  }
  .sectitle {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
  }
  .info {
    display: inline-flex;
    color: var(--text-faint);
  }
  /* A labelled control the param rows can't hold (segments, a timing, an order): label above. */
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .flabel {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .field :global(.fsel) {
    width: 100%;
  }
  .layer {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    padding-top: var(--space-1_5);
    border-top: 1px solid var(--border-faint);
  }
  .order {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    min-width: 0;
  }
</style>
