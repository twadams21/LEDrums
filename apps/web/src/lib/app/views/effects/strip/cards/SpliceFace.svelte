<script lang="ts">
  /* The Splice / Slice Generator's settings, laid out by the Generator standard
     (docs/design/generator-standard.md; Tim, 2026-10-07: "is there a reason that splice has
     maintained its colours at the start of the card, rather than in the order that rule 2 would
     enforce?"), three fixed columns:
       SPLICES / SLICES (FORM) · [Slice: START — On, its drum or its Space box] · SHAPE
       MOVEMENT — Around (how the light acts within its area) and Through (where it is sent: drum to
                  drum, hoop to hoop, splice to splice) as labelled sub-headings, one section (Tim:
                  "only if they are still kept as sub sections that are clear and easy to
                  recognise")
       TIMING (on each hit, while waiting) · COLOUR (every band's colour, Tint, a Slice's colour chase)
     The band list (each band's Generator, on/off, order) stays in the card's lead column; its
     colours are under COLOUR. A setting that doesn't apply in the current mode is DIMMED in place,
     its ⓘ saying when it applies — never hidden — so the card never moves. No envelope (it is the
     Effect's, on the Trigger card) and no Velocity (the Velocity Control's job). */
  import type { Snippet } from 'svelte';
  import { effectChain } from '@ledrums/core';
  import type { EffectsAuthoringApi } from '../../../../../trigger-lab/effects-api';
  import type { MappableSpec } from '../../../../../trigger-lab/map-api';
  import SegmentedControl from '../../../../../ui/SegmentedControl.svelte';
  import Select from '../../../../../ui/Select.svelte';
  import OrderList from '../../../../../ui/OrderList.svelte';
  import Tooltip from '../../../../../ui/Tooltip.svelte';
  import CommitInput from '../../../../../ui/CommitInput.svelte';
  import Info from '@lucide/svelte/icons/info';
  import ParamRows from './ParamRows.svelte';
  import BandColours from './BandColours.svelte';
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
  // FORM: how many, how uneven (a Random under it), the seed of that randomness.
  const formRows = $derived([
    P('count', { label: isSlice ? 'Slices' : 'Splices' }),
    P('jitter', { label: 'Random', aria: 'Random lengths', sub: true, percent: true, unit: '%', info: 'How uneven the lengths are. 0%: all the same.' }),
    P('seed', { label: 'Seed', sub: true, ...(jitter > 0 ? {} : { inactive: 'Only when Random is above 0%' }) }),
  ]);
  const rotateRow = $derived([P('rotationDeg', { label: 'Rotate' })]);
  const smudgeRow = $derived([P('smudge', { label: 'Smudge', percent: true, unit: '%' })]);
  // Tint: how strongly a band's colour recolours its Generator — it acts once a band has both.
  const anyTinted = $derived((effect.generator.slots ?? []).some((sl) => !sl.muted && !!sl.color && !!sl.generator));
  const tintRow = $derived<CardParam[]>([
    { key: 'tint', label: 'Tint', kind: 'number', min: 0, max: 1, step: 0.01, default: 1, percent: true, unit: '%',
      info: 'How strongly a band\'s colour recolours its Generator.', ...(anyTinted ? {} : { inactive: 'Only when a band has both a colour and a Generator' }) },
  ]);
  const motionOn = $derived(chase !== 'off');
  const MOTION_OFF = 'Only when Motion is on';
  const increment = $derived({
    ...(isSlice ? P('incrementPct', { label: 'Increment' }) : P('incrementPx', { label: 'Increment' })),
    ...(chase === 'stagger' ? {} : { inactive: 'Only when Motion is Stagger' }),
  });

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
    /** When it doesn't apply: why — it is dimmed in place, never hidden. */
    why?: string;
  }
  const layers = $derived.by((): LayerView[] => (isSlice ? sliceLayers() : spliceLayers()));
  const LIT_WAIT = "Only when While waiting isn't Lit";
  function sliceLayers(): LayerView[] {
    return [
      {
        label: 'Through kit',
        info: 'Sends the light from drum to drum across the kit, one step apart, in the order below.',
        aria: 'Through kit',
        layer: throughKitLayer('hoop'),
        items: drums,
        orderOptions: SPLICE_ORDER_OPTS,
        // One drum has nothing to send light across.
        ...(sliceOn !== 'drum' && kitDrums > 1 ? {} : { why: 'Only when On is Kit or Space, across more than one drum' }),
      },
      {
        label: 'Through slices',
        info: 'Sends the light from slice to slice through the kit, one step apart, in the order below.',
        aria: 'Through slices',
        layer: THROUGH_SLICES_LAYER,
        items: null,
        orderOptions: SPLICE_ORDER_OPTS,
      },
    ];
  }
  /** A Slice's colour chase — colours arriving one after another — sits under COLOUR. */
  const colourChase = $derived<LayerView>({
    label: 'Colour chase',
    info: 'Brings the colours on one after another instead of all together, in the colour order below. With Pulse each one fades in and out on its own.',
    aria: 'Colour chase',
    layer: AROUND_LAYER,
    items: null,
    orderOptions: SPLICE_ORDER_OPTS,
    // Colour arrival is a reveal: with Lit every colour is already on.
    ...(showAround(waitMode) ? {} : { why: LIT_WAIT }),
  });
  function spliceLayers(): LayerView[] {
    return [
      {
        label: 'Through kit',
        info: 'Sends the light from drum to drum across the kit, one step apart, in the order below. With Through drum as well, it spirals.',
        aria: 'Through kit',
        layer: throughKitLayer(partition),
        items: drums,
        orderOptions: SPLICE_ORDER_OPTS,
        ...(showThroughKit(partition, kitDrums) ? {} : { why: partition === 'scope' ? 'Only when Per is Hoop or Drum' : 'Only when the Target lights more than one drum' }),
      },
      {
        label: 'Through drum',
        info: 'Sends the light from hoop to hoop up each drum, one step apart, in the order below.',
        aria: 'Through drum',
        layer: THROUGH_DRUM_LAYER,
        items: hoops,
        orderOptions: SPLICE_ORDER_OPTS,
        ...(showThroughDrum(partition) ? {} : { why: 'Only when Per is Hoop' }),
      },
      {
        label: aroundLabel(partition).toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
        info: 'Brings each splice on after the one before it, one step apart, in the order below.',
        aria: 'Around',
        layer: AROUND_LAYER,
        items: null,
        orderOptions: SPLICE_AROUND_ORDER_OPTS,
        ...(showAround(waitMode) ? {} : { why: LIT_WAIT }),
      },
    ];
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

<!-- A sub-heading inside a section (MOVEMENT's Around and Through). -->
{#snippet subhead(title: string)}
  <h5 class="subtitle">{title}</h5>
{/snippet}

<!-- A labelled control; `why` dims it in place and leads its ⓘ (it doesn't apply right now). -->
{#snippet field(label: string, info: string | undefined, control: Snippet, why?: string)}
  {@const about = why ? `${why}.${info ? ` ${info}` : ''}` : info}
  <div class="field" class:inactive={!!why}>
    <span class="flabel">
      {label}
      {#if about}
        <Tooltip text={about} side="top">
          <span class="info" aria-label={`About ${label}`}><Info size={11} aria-hidden="true" /></span>
        </Tooltip>
      {/if}
    </span>
    {@render control()}
  </div>
{/snippet}

{#snippet timing(label: string, info: string | undefined, aria: string, keys: TimingKeys, options: { value: string; label: string }[], fallback: string, why?: string)}
  {#snippet control()}
    <Select
      value={timingValue(params, keys, fallback)}
      {options}
      segment={false}
      disabled={disabled || !!why}
      ariaLabel={`${aria} division`}
      onChange={(v) => setMany(timingPatch(v, keys))}
      class="fsel"
    />
  {/snippet}
  {@render field(label, info, control, why)}
  <!-- Its own time, in ms — dimmed unless Free (ms) is picked, so the card keeps its shape. -->
  {@const free = str(keys.mode, 'beats') === 'time'}
  <ParamRows
    params={[{ ...msParam(keys, 'Time'), sub: true, ...(why ? { inactive: why } : free ? {} : { inactive: `Only when ${label} is Free (ms)` }) }]}
    values={params} {modulated} {disabled} labelPrefix={aria} {mapParam} onChange={onRow} {...gesture}
  />
{/snippet}

<!-- Three numbers on one row, X / Y / Z — the shape the tilt, centre and size share. -->
{#snippet xyz(label: string, info: string | undefined, keys: readonly string[], unit: string, aria: string, why?: string)}
  {#snippet row()}
    <div class="xyz">
      {#each ['X', 'Y', 'Z'] as axisName, i (axisName)}
        <CommitInput
          type="number"
          value={num(keys[i]!, 0)}
          step={1}
          disabled={disabled || !!why}
          onCommit={(v) => (keys[i]!.startsWith('region') ? setRegion(keys[i] as RegionKey, Number(v)) : set(keys[i]!, Number(v)))}
          ariaLabel={`${aria} ${axisName}`}
        />
      {/each}
    </div>
  {/snippet}
  {@render field(`${label} (${unit})`, info, row, why)}
{/snippet}

<!-- One Through layer: its offset, then its order (dimmed until the offset sends light). -->
{#snippet layerRows(view: LayerView)}
  {@const orderWhy = view.why ?? (timingActive(params, view.layer.keys) ? undefined : `Only when ${view.label} isn't None`)}
  <div class="layer">
    {@render timing(view.label, view.info, view.aria, view.layer.keys, OFFSET_OPTIONS, NO_DIVISION, view.why)}
    {#if view.items && view.layer.sequence}
      {@const seq = sequenceOf(params, view.layer.sequence)}
      {#snippet order()}
        <div class="order">
          <OrderList
            items={ordered(view)}
            disabled={disabled || !!orderWhy}
            ariaLabel={`${view.aria} order`}
            onReorder={(ids) => set(view.layer.sequence!, ids.join(','))}
          />
          <!-- No pattern lit while a dragged order is in charge: the chips ARE the order. -->
          <SegmentedControl
            value={seq.length ? '' : str(view.layer.pattern, 'up')}
            options={view.orderOptions}
            disabled={disabled || !!orderWhy}
            ariaLabel={`${view.aria} order pattern`}
            onChange={(v) => setPattern(view.layer, v)}
          />
        </div>
      {/snippet}
      {@render field('Order', ORDER_INFO, order, orderWhy)}
    {:else}
      {#snippet orderSelect()}
        <Select
          value={str(view.layer.pattern, 'up')}
          options={view.orderOptions}
          segment={false}
          disabled={disabled || !!orderWhy}
          ariaLabel={`${view.aria} order`}
          onChange={(v) => setPattern(view.layer, v)}
          class="fsel"
        />
      {/snippet}
      {@render field('Order', undefined, orderSelect, orderWhy)}
    {/if}
  </div>
{/snippet}

<div class="sections">
  <!-- Column 1: FORM · (START) · SHAPE -->
  <div class="col">
    <section class="sec" aria-label={isSlice ? 'Slices' : 'Splices'}>
      {@render head(isSlice ? 'Slices' : 'Splices')}
      <ParamRows params={formRows.slice(0, 1)} values={params} {modulated} {disabled} labelPrefix={noun} {mapParam} onChange={onRow} {...gesture} />
      {#if !isSlice}
        {#snippet per()}
          <SegmentedControl value={partition} options={SPLICE_PARTITION_OPTS} {disabled} ariaLabel="Splice partition" onChange={(v) => set('partition', v)} />
        {/snippet}
        {@render field('Per', 'What each set of splices spans: a hoop, a drum, or the whole Target as one run.', per)}
      {/if}
      <ParamRows params={formRows.slice(1)} values={params} {modulated} {disabled} labelPrefix={noun} {mapParam} onChange={onRow} {...gesture} />
    </section>

    {#if isSlice}
      <section class="sec" aria-label="Start">
        {@render head('Start')}
        {#snippet onCtl()}
          <SegmentedControl value={sliceOn} options={SLICE_ON_OPTS} {disabled} ariaLabel="Slice scope" onChange={setOn} />
        {/snippet}
        {@render field('On', ON_INFO, onCtl)}
        {#snippet drumCtl()}
          <Select value={drumValue} options={drumOptions} segment={false} disabled={disabled || sliceOn !== 'drum'} ariaLabel="Slice drum" onChange={setDrum} class="fsel" />
        {/snippet}
        {@render field('Drum', undefined, drumCtl, sliceOn === 'drum' ? undefined : 'Only when On is Drum')}
        {@render xyz('Centre', REGION_INFO, ['regionCx', 'regionCy', 'regionCz'], 'mm', 'Slice region centre', sliceOn === 'space' ? undefined : 'Only when On is Space')}
        {@render xyz('Size', undefined, ['regionSx', 'regionSy', 'regionSz'], 'mm', 'Slice region size', sliceOn === 'space' ? undefined : 'Only when On is Space')}
      </section>
    {/if}

    <section class="sec" aria-label="Shape">
      {@render head('Shape')}
      {#if isSlice}
        {#snippet axisCtl()}
          <SegmentedControl value={str('axis', 'x')} options={SLICE_AXIS_OPTS} {disabled} ariaLabel="Slice axis" onChange={(v) => set('axis', v)} />
        {/snippet}
        {@render field('Axis', AXIS_INFO, axisCtl)}
        {@render xyz('Tilt', TILT_INFO, ['rotX', 'rotY', 'rotZ'], '°', 'Slice tilt')}
      {:else}
        <ParamRows params={rotateRow} values={params} {modulated} {disabled} labelPrefix={noun} {mapParam} onChange={onRow} {...gesture} />
      {/if}
      <ParamRows params={smudgeRow} values={params} {modulated} {disabled} labelPrefix={noun} {mapParam} onChange={onRow} {...gesture} />
    </section>
  </div>

  <!-- Columns 2–3: MOVEMENT — Around, then Through — one section, its rows flowing down two
       balanced columns under the one title (Through alone is three layers tall). -->
  <div class="col wide">
    <section class="sec" aria-label="Movement">
      {@render head('Movement')}
      <div class="flow">
      {@render subhead('Around')}
      {#snippet motion()}
        <SegmentedControl value={chase} options={isSlice ? SLICE_CHASE_OPTS : SPLICE_CHASE_OPTS} {disabled} ariaLabel={`${noun} motion`} onChange={(v) => set('chase', v)} />
      {/snippet}
      {@render field('Motion', (isSlice ? SLICE_CHASE_HINTS : SPLICE_CHASE_HINTS)[chase], motion)}
      {@render timing('Rate', undefined, `${noun} rate`, RATE_KEYS, RATE_OPTIONS, '1/8', motionOn ? undefined : MOTION_OFF)}
      <ParamRows params={[increment]} values={params} {modulated} {disabled} labelPrefix={noun} {mapParam} onChange={onRow} {...gesture} />
      {#snippet direction()}
        <SegmentedControl
          value={num('direction', 1) < 0 ? '-1' : '1'}
          options={SPLICE_DIRECTION_OPTS}
          disabled={disabled || !motionOn}
          ariaLabel={`${noun} direction`}
          onChange={(v) => set('direction', v === '-1' ? -1 : 1)}
        />
      {/snippet}
      {@render field('Direction', undefined, direction, motionOn ? undefined : MOTION_OFF)}

      {@render subhead('Through')}
      {#each layers as view (view.aria)}
        {@render layerRows(view)}
      {/each}
      </div>
    </section>
  </div>

  <!-- Column 3: TIMING · COLOUR -->
  <div class="col">
    <section class="sec" aria-label="Timing">
      {@render head('Timing')}
      {#snippet onHit()}
        <SegmentedControl value={motionMode} options={SPLICE_MOTION_MODE_OPTS} disabled={disabled || !motionOn} ariaLabel={`${noun} motion mode`} onChange={(v) => set('motionMode', v)} />
      {/snippet}
      {@render field('On each hit', SPLICE_MOTION_MODE_HINTS[motionMode], onHit, motionOn ? undefined : MOTION_OFF)}
      {#snippet waiting()}
        <SegmentedControl value={waitMode} options={SPLICE_WAIT_MODE_OPTS} {disabled} ariaLabel={`${noun} while waiting`} onChange={(v) => set('waitMode', v)} />
      {/snippet}
      {@render field('While waiting', SPLICE_WAIT_MODE_HINTS[waitMode], waiting)}
    </section>

    <section class="sec" aria-label="Colour">
      {@render head('Colour')}
      {#snippet bands()}
        <BandColours {api} {effect} {disabled} />
      {/snippet}
      {@render field(isSlice ? 'Slices' : 'Splices', 'Each band\'s colour, in band order — a band with no colour plays its Generator untinted. Click a box to pick, or clear it.', bands)}
      <ParamRows params={tintRow} values={params} {modulated} {disabled} labelPrefix={noun} {mapParam} onChange={onRow} {...gesture} />
      {#if isSlice}
        {@render layerRows(colourChase)}
      {/if}
    </section>
  </div>
</div>

<style>
  .sections {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
  }
  /* Three fixed columns; their sections stack, a hairline between columns. */
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    flex: none;
    /* Wide enough for the inspector's longest segments (Restart · Continuous · Latched, the order
       patterns) without clipping. */
    width: 280px;
    min-width: 0;
  }
  .col.wide {
    width: calc(560px + var(--space-4));
  }
  /* MOVEMENT's rows, column-major down two columns; a field, a layer, a sub-heading never split. */
  .flow {
    columns: 2;
    column-gap: var(--space-4);
    column-rule: 1px solid var(--border-faint);
  }
  .flow > :global(*) {
    break-inside: avoid;
    margin-bottom: var(--space-1_5);
  }
  .flow > .subtitle {
    break-after: avoid;
  }
  /* Through starts a new group: air above it, as above a section title. */
  .flow > .subtitle ~ .subtitle {
    margin-top: var(--space-2);
  }
  .col + .col {
    margin-left: calc(-1 * var(--space-2));
    padding-left: var(--space-4);
    box-shadow: inset 1px 0 0 var(--border-faint);
  }
  /* MOVEMENT's Around and Through: smaller than a section title, still capitalised. */
  .subtitle {
    margin: var(--space-1) 0 0;
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-faint);
    opacity: 0.85;
  }
  /* A setting that doesn't apply in the current mode: in its place, greyed (its ⓘ says when). */
  .field.inactive > :global(:not(.flabel)) {
    opacity: 0.38;
  }
  .field.inactive > .flabel {
    color: var(--text-faint);
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: var(--space-1_5);
    flex: none;
    min-width: 0;
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
