<script lang="ts">
  /* The Splice / Slice Generator's settings in the graph-era Splice and Slice inspectors' sections
     and words (Tim, 2026-10-01: "bring it back as close to that version, if not exactly the same …
     with the new layout"; then the same for Slice), one column each, left to right:
       SPLICE        — how many splices, per what, where the cut sits, how uneven, how soft.
       MOVE AROUND   — how the light acts WITHIN that area: chase, spin or stagger, at a rate.
       MOVE THROUGH  — where the light is SENT: drum to drum, hoop to hoop, splice to splice, each
                       in an order you drag or pick — and what waiting parts do.
       BRIGHTNESS ENVELOPE — attack, curve, sustain, decay.
     A Slice's first section is SLICE instead — On (Kit · Drum · Space, a box of the room), Axis,
     Tilt, Slices, Random lengths, Smudge, Seed, Velocity — and its MOVE THROUGH layers are THROUGH
     KIT · THROUGH SLICES · COLOUR CHASE. A Slice's On writes the Effect's Target (and its Space
     box), so it and the Target card are one setting seen twice.
     The rows sit in the card's lead column with the kind picker. Not carried over, because the
     Effect owns them now: a Splice's old "On / Target" scope (the Target card), and the envelope's
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
  import CommitInput from '../../../../../ui/CommitInput.svelte';
  import Info from '@lucide/svelte/icons/info';
  import ParamRows from './ParamRows.svelte';
  import { drumHoopCount, kitBounds } from '../strip-model';
  import { toCardParam, type CardParam, type ParamValue } from './card-model';
  import {
    AROUND_LAYER,
    NO_REGION,
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
    SLICE_AXIS_OPTS,
    SLICE_CHASE_HINTS,
    SLICE_CHASE_OPTS,
    SLICE_ON_OPTS,
    THROUGH_DRUM_LAYER,
    THROUGH_SLICES_LAYER,
    NO_DIVISION,
    aroundLabel,
    effectiveOrder,
    regionFromBounds,
    sequenceOf,
    sliceOnOf,
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
    type RegionKey,
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
  const isSlice = $derived(effect.generator.kind === 'slice');
  const noun = $derived(isSlice ? 'Slice' : 'Splice');

  // The spec's own params (range, step, unit), relabelled in the inspector's words. Slice's spec is
  // Splice's minus the partition and pixel stagger, plus its geometry.
  const SPEC = $derived(new Map(effectChain.spliceGeneratorParamSpec(effect.generator.kind).map((s) => [s.key, toCardParam(s)])));
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
  function setMany(patch: Record<string, ParamValue | undefined>): void {
    api.setGeneratorParams(effect.id, patch);
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
  const sliceCountRow = $derived([P('count', { label: 'Slices' })]);
  const VELOCITY_INFO =
    'How much a hit’s velocity sets the brightness. 0% ignores it — every hit is full brightness; 100% makes a soft hit a dim slice and a hard hit a bright one.';
  const sliceRows = $derived([
    P('jitter', { label: 'Random lengths', percent: true, unit: '%' }),
    P('smudge', { label: 'Smudge', percent: true, unit: '%' }),
    ...(jitter > 0 ? [P('seed', { label: 'Seed' })] : []),
    P('velocity', { label: 'Velocity', percent: true, unit: '%', info: VELOCITY_INFO }),
  ]);
  const envelopeLead = $derived([P('attackMs', { label: 'Attack' })]);
  const envelopeTail = $derived([P('holdMs', { label: 'Sustain' }), P('releaseMs', { label: 'Decay' })]);
  const increment = $derived(isSlice ? P('incrementPct', { label: 'Increment' }) : P('incrementPx', { label: 'Increment' }));

  /** The kit's drums, in grid order (THROUGH KIT's chips, a Drum slice's choices). */
  const drums = $derived(api.gridRows.filter((r) => r.id !== 'kit').map((r) => ({ id: r.id, label: r.label })));

  // ---- SLICE: what it cuts — written to the Effect's Target (and the Space box) ----------------
  const sliceOn = $derived(sliceOnOf(effect.target ?? { kind: 'kit' }, params));
  const AUTO_DRUM = '@auto';
  const drumOptions = $derived([{ value: AUTO_DRUM, label: 'Auto (triggering drum)' }, ...drums.map((d) => ({ value: d.id, label: d.label }))]);
  const drumValue = $derived.by(() => {
    const t = effect.target;
    return t?.kind === 'select' && t.drums.length === 1 ? t.drums[0]!.drumId : AUTO_DRUM;
  });
  function setOn(on: string): void {
    if (on === sliceOn) return;
    api.beginGesture();
    if (on === 'drum') api.setTarget(effect.id, { kind: 'hitDrum' });
    else api.setTarget(effect.id, { kind: 'kit' });
    api.setGeneratorParams(effect.id, on === 'space' ? regionFromBounds(kitBounds(api)) : NO_REGION);
    api.endGesture();
  }
  function setDrum(v: string): void {
    api.setTarget(effect.id, v === AUTO_DRUM ? { kind: 'hitDrum' } : { kind: 'select', drums: [{ drumId: v }] });
  }
  /** A Space box edit: sizes stay at least 1mm. */
  function setRegion(key: RegionKey, value: number): void {
    if (!Number.isFinite(value)) return;
    set(key, key.startsWith('regionS') ? Math.max(1, value) : value);
  }
  const ON_INFO = 'Kit slices the whole kit; Drum only one drum; Space only a box of the room you place and size below.';
  const AXIS_INFO = 'The direction the slices are stacked along. Each slice is a flat slab across the kit, facing along this axis.';
  const TILT_INFO = 'Tilts the slices about the world X, Y and Z axes, in degrees — so a slice can cut diagonally through the kit.';
  const REGION_INFO = 'The box of space to slice, in millimetres: where its centre sits, and how big it is along each axis.';

  // ---- MOVE THROUGH: which layers, over what -----------------------------------------------------
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
  const layers = $derived.by((): LayerView[] => (isSlice ? sliceLayers() : spliceLayers()));
  function sliceLayers(): LayerView[] {
    const out: LayerView[] = [];
    // One drum has nothing to send light across, so a Drum slice has no THROUGH KIT.
    if (sliceOn !== 'drum' && kitDrums > 1) {
      out.push({
        label: 'THROUGH KIT',
        info: 'Sends the light from drum to drum across the kit, one step apart, in the order below.',
        aria: 'Through kit',
        layer: throughKitLayer('hoop'),
        items: drums,
        orderOptions: SPLICE_ORDER_OPTS,
      });
    }
    out.push({
      label: 'THROUGH SLICES',
      info: 'Sends the light from slice to slice through the kit, one step apart, in the order below.',
      aria: 'Through slices',
      layer: THROUGH_SLICES_LAYER,
      items: null,
      orderOptions: SPLICE_ORDER_OPTS,
    });
    // Colour arrival is a reveal: with Lit every colour is already on.
    if (showAround(waitMode)) {
      out.push({
        label: 'COLOUR CHASE',
        info: 'Brings the colours on one after another instead of all together, in the colour order below. With Pulse each one fades in and out on its own.',
        aria: 'Colour chase',
        layer: AROUND_LAYER,
        items: null,
        orderOptions: SPLICE_ORDER_OPTS,
      });
    }
    return out;
  }
  function spliceLayers(): LayerView[] {
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
  }

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

<!-- Three numbers on one row, X / Y / Z — the shape the tilt, centre and size share. -->
{#snippet xyz(label: string, info: string | undefined, keys: readonly string[], unit: string, aria: string)}
  {#snippet row()}
    <div class="xyz">
      {#each ['X', 'Y', 'Z'] as axisName, i (axisName)}
        <CommitInput
          type="number"
          value={num(keys[i]!, 0)}
          step={1}
          {disabled}
          onCommit={(v) => (keys[i]!.startsWith('region') ? setRegion(keys[i] as RegionKey, Number(v)) : set(keys[i]!, Number(v)))}
          ariaLabel={`${aria} ${axisName}`}
        />
      {/each}
    </div>
  {/snippet}
  {@render field(`${label} (${unit})`, info, row)}
{/snippet}

<div class="sections">
  {#if isSlice}
  <!-- SLICE -->
  <section class="sec" aria-label="Slice">
    {@render head('Slice')}
    {#snippet onCtl()}
      <SegmentedControl value={sliceOn} options={SLICE_ON_OPTS} {disabled} ariaLabel="Slice scope" onChange={setOn} />
    {/snippet}
    {@render field('On', ON_INFO, onCtl)}
    {#if sliceOn === 'drum'}
      {#snippet drumCtl()}
        <Select value={drumValue} options={drumOptions} segment={false} {disabled} ariaLabel="Slice drum" onChange={setDrum} class="fsel" />
      {/snippet}
      {@render field('Target', undefined, drumCtl)}
    {/if}
    {#if sliceOn === 'space'}
      {@render xyz('Centre', REGION_INFO, ['regionCx', 'regionCy', 'regionCz'], 'mm', 'Slice region centre')}
      {@render xyz('Size', undefined, ['regionSx', 'regionSy', 'regionSz'], 'mm', 'Slice region size')}
    {/if}
    {#snippet axisCtl()}
      <SegmentedControl value={str('axis', 'x')} options={SLICE_AXIS_OPTS} {disabled} ariaLabel="Slice axis" onChange={(v) => set('axis', v)} />
    {/snippet}
    {@render field('Axis', AXIS_INFO, axisCtl)}
    {@render xyz('Tilt', TILT_INFO, ['rotX', 'rotY', 'rotZ'], '°', 'Slice tilt')}
    <ParamRows params={sliceCountRow} values={params} {modulated} {disabled} labelPrefix="Slice" {mapParam} onChange={onRow} {...gesture} />
    <ParamRows params={sliceRows} values={params} {modulated} {disabled} labelPrefix="Slice" {mapParam} onChange={onRow} {...gesture} />
  </section>
  {:else}
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
  {/if}

  <!-- MOVE AROUND -->
  <section class="sec" aria-label="Move around">
    {@render head('Move around')}
    {#snippet motion()}
      <SegmentedControl value={chase} options={isSlice ? SLICE_CHASE_OPTS : SPLICE_CHASE_OPTS} {disabled} ariaLabel={`${noun} motion`} onChange={(v) => set('chase', v)} />
    {/snippet}
    {@render field('Motion', (isSlice ? SLICE_CHASE_HINTS : SPLICE_CHASE_HINTS)[chase], motion)}
    {#if chase !== 'off'}
      {#snippet onHit()}
        <SegmentedControl value={motionMode} options={SPLICE_MOTION_MODE_OPTS} {disabled} ariaLabel={`${noun} motion mode`} onChange={(v) => set('motionMode', v)} />
      {/snippet}
      {@render field('On each hit', SPLICE_MOTION_MODE_HINTS[motionMode], onHit)}
      {@render timing('Rate', undefined, `${noun} rate`, RATE_KEYS, RATE_OPTIONS, '1/8')}
      {#if chase === 'stagger'}
        <ParamRows params={[increment]} values={params} {modulated} {disabled} labelPrefix={noun} {mapParam} onChange={onRow} {...gesture} />
      {/if}
      {#snippet direction()}
        <SegmentedControl
          value={num('direction', 1) < 0 ? '-1' : '1'}
          options={SPLICE_DIRECTION_OPTS}
          {disabled}
          ariaLabel={`${noun} direction`}
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
      <SegmentedControl value={waitMode} options={SPLICE_WAIT_MODE_OPTS} {disabled} ariaLabel={`${noun} move through mode`} onChange={(v) => set('waitMode', v)} />
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
    <ParamRows params={envelopeLead} values={params} {modulated} {disabled} labelPrefix={noun} {mapParam} onChange={onRow} {...gesture} />
    {#snippet curve()}
      <EasePicker
        value={{ fn: str('attackEaseFn', 'linear') as never, dir: str('attackEaseDir', 'in') as never }}
        {disabled}
        ariaLabel={`${noun} attack curve`}
        onChange={(v) => setMany({ attackEaseFn: v.fn, attackEaseDir: v.dir })}
      />
    {/snippet}
    {@render field('Curve', 'A linear attack reads as brightening too fast — an ease-in curve swells more evenly.', curve)}
    <ParamRows params={envelopeTail} values={params} {modulated} {disabled} labelPrefix={noun} {mapParam} onChange={onRow} {...gesture} />
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
  /* Three equal number fields that shrink together, never wrapping: X, Y, Z read left to right. */
  .xyz {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-1);
    min-width: 0;
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
