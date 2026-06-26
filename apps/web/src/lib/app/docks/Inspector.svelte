<script lang="ts">
  /* Right-dock Inspector — contextual settings for whatever is selected in the
     shell (a trigger-graph node, a layer/bus, or a Patch device). There is no
     separate Settings page; switching views resets the selection. Effect Gallery,
     Envelope Editor and Effect Creator stay as summoned overlays — opened from
     here via the engine store. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { describePatchNode } from '../patch-topology';
  import { describeTriggerSource, zoneLabel } from '../trigger-source-label';
  import { ZONE_LABELS } from '../../trigger-lab/fixtures';
  import {
    NODE_KINDS,
    type GraphNode,
    type NodeKind,
    type ParamSpec,
    type ParamValue,
    type Polyphony,
    type SwitchOn,
    type TriggerSource,
    type ValueMode,
  } from '../../trigger-lab/sim';
  import { busIcon, kindIcon, kindLabel, tint } from '../views/trigger-node-meta';
  import EffectThumb from '../../trigger-lab/EffectThumb.svelte';
  import Slider from '../../ui/Slider.svelte';
  import Select from '../../ui/Select.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Field from '../../ui/Field.svelte';
  import CommitInput from './CommitInput.svelte';
  import type { DrumConfig, KitConfig, RgbOrder } from '@ledrums/core';
  import { patchToOutputs, pixelRanges, type HoopRef, type PatchRouting, type PixelSpan } from '../patch-routing';
  import {
    hoopPixelSpan,
    orderedDataLines,
    patchEditorFor,
    pixelsPerHoopForDrum,
    setZoneMidiNote,
    setZoneOscAddress,
    zoneMidiNote,
    zoneOscAddress,
    type PatchEditor,
  } from './patch-inspector';
  import Replace from '@lucide/svelte/icons/replace';
  import Spline from '@lucide/svelte/icons/spline';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Zap from '@lucide/svelte/icons/zap';
  import Repeat from '@lucide/svelte/icons/repeat';
  import Hand from '@lucide/svelte/icons/hand';
  import Plus from '@lucide/svelte/icons/plus';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const sel = $derived(shell.selection);

  // resolve a node selection against the active graph
  const node = $derived.by<GraphNode | null>(() => {
    if (sel?.kind !== 'node') return null;
    return store.selectedGraph?.nodes.find((n) => n.id === sel.nodeId) ?? null;
  });
  const eff = $derived(node && node.kind === 'play' ? store.effectOf(node) : undefined);
  const live = $derived(node && node.kind === 'play' ? store.liveParams(node) : {});
  const presetOptions = $derived(
    eff ? store.presetsForEffect(eff.id).map((p) => ({ value: p.id, label: p.name })) : [],
  );

  const bus = $derived(sel?.kind === 'bus' ? store.buses.find((b) => b.id === sel.busId) ?? null : null);

  // --- Patch graph per-node editors (S4) -----------------------------------------
  // Each Patch node edits the real device setting it represents: geometry/input read from
  // the authoritative store.project and write back through the S3 mutators. Read-outs
  // (first/last pixel, ordering) derive from the LIVE graph routing the patch view publishes
  // (shell.patchRouting) — keyed by the actual graph node ids — so a just-added palette data
  // line or an un-remounted reorder reads correctly (S5b). No-op-safe while offline (project
  // null): pixelsForHoop returns 0 without a kit, so spans simply don't resolve.
  const patchId = $derived(sel?.kind === 'patch' ? sel.nodeId : null);
  const ed = $derived<PatchEditor | null>(patchId ? patchEditorFor(patchId) : null);
  const project = $derived(store.project);
  const kit = $derived<KitConfig | null>(project?.kit ?? null);
  const outputCfg = $derived(project?.output ?? null);

  const liveRouting = $derived<PatchRouting | null>(shell.patchRouting);
  function pixelsForHoop(h: HoopRef): number {
    const d = kit?.drums.find((x) => x.id === h.drumId);
    return d && kit ? pixelsPerHoopForDrum(d, kit) : 0;
  }
  const ranges = $derived(liveRouting ? pixelRanges(liveRouting, pixelsForHoop) : null);
  const orderedLines = $derived(liveRouting ? orderedDataLines(liveRouting) : []);

  // the drum behind a drum / hoop / zone selection; the OutputConfig behind an output one.
  const patchDrum = $derived.by<DrumConfig | null>(() => {
    if (!kit || !ed || !('drumId' in ed)) return null;
    return kit.drums.find((x) => x.id === ed.drumId) ?? null;
  });
  const patchOutput = $derived.by(() => {
    if (!kit || ed?.kind !== 'output') return null;
    return kit.outputs.find((o) => o.id === ed.outputId) ?? null;
  });

  function patchLabel(id: string, fallback: string): string {
    return store.patchLabels[id]?.trim() || fallback;
  }
  function commitLabel(id: string, fallback: string, raw: string): void {
    const v = raw.trim();
    store.setPatchLabel(id, v && v !== fallback ? v : '');
  }
  function drumName(drumId: string): string {
    return store.drums.find((x) => x.id === drumId)?.label ?? drumId;
  }
  /** Apply a finite parsed number from a CommitInput; a cleared ('') field is ignored. */
  function onNum(raw: string, apply: (n: number) => void): void {
    if (raw === '') return;
    const n = Number(raw);
    if (Number.isFinite(n)) apply(n);
  }
  function setAxis(drumId: string, field: 'origin' | 'rotation', axis: 'x' | 'y' | 'z', n: number): void {
    const d = kit?.drums.find((x) => x.id === drumId);
    if (d) store.setDrumTransform(drumId, { [field]: { ...d[field], [axis]: n } });
  }
  /** Rebuild the outputs array with one port's transport scalars changed → setRouting.
      A blank `startUniverse` (undefined) clears the snap → the port packs dense. */
  function setOutputScalar(outputId: string, partial: { startUniverse?: number; channelsPerPixel?: number }): void {
    if (!kit) return;
    store.setRouting(kit.outputs.map((o) => (o.id === outputId ? { ...o, ...partial } : o)));
  }
  /** Set (or clear, when undefined) a data line's optional startUniverse snap, keyed by its
      graph node id — edits the LIVE routing and recompiles → setRouting. Blank = dense. */
  function setDataLineUniverse(lineNodeId: string, startUniverse: number | undefined): void {
    if (!liveRouting) return;
    const updated: PatchRouting = {
      outputs: liveRouting.outputs.map((o) => ({
        ...o,
        dataLines: o.dataLines.map((dl) => (dl.id === lineNodeId ? { ...dl, startUniverse } : dl)),
      })),
    };
    store.setRouting(patchToOutputs(updated));
  }
  /** A universe-snap read-out: an explicit universe, or "dense" when the line/port auto-packs. */
  const uLabel = (u: number | undefined): string => (u === undefined ? 'dense' : `u${u}`);
  function setZoneNote(drumId: string, slot: number, note: number | null): void {
    if (project) store.setInputMap(setZoneMidiNote(project.inputMap, drumId, slot, note));
  }
  function setZoneOsc(drumId: string, slot: number, address: string | null): void {
    if (project) store.setInputMap(setZoneOscAddress(project.inputMap, drumId, slot, address));
  }

  const PROTOCOL_OPTS = [
    { value: 'artnet', label: 'Art-Net' },
    { value: 'sacn', label: 'sACN (E1.31)' },
  ];
  const RGB_OPTS = (['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'] as const).map((o) => ({ value: o, label: o }));
  const fmtSpan = (s: PixelSpan | null | undefined): string => (s ? `${s.first} – ${s.last}` : '—');

  // iconed play-mode + layer groups (Zap/Repeat/Hand · Disc3/Activity/Wand2) — same
  // SegmentedControl, just an icon per option (ported from the old node header).
  const MODE_OPTS = [
    { value: 'oneshot', label: 'One-shot', icon: Zap },
    { value: 'loop', label: 'Loop', icon: Repeat },
    { value: 'hold', label: 'Hold', icon: Hand },
  ];
  const LAYER_OPTS = $derived(store.buses.map((b) => ({ value: b.id, label: b.name, icon: busIcon[b.id] })));
  const LINK_OPTS = [
    { value: 'instance', label: 'Instance' },
    { value: 'linked', label: 'Linked' },
  ];
  const POLY_OPTS = [
    { value: 'mono', label: 'mono' },
    { value: 'poly', label: 'poly' },
  ];

  // kind selector (every node but the trigger root) + switch routing options.
  const KIND_OPTS = NODE_KINDS.map((k) => ({ value: k, label: kindLabel[k], icon: kindIcon[k], iconColor: tint[k] }));
  const SWITCH_OPTS: Array<{ value: SwitchOn; label: string }> = [
    { value: 'value', label: 'value' },
    { value: 'section', label: 'section' },
    { value: 'beat', label: 'beat' },
  ];
  const VALUEMODE_OPTS: Array<{ value: ValueMode; label: string }> = [
    { value: 'gate', label: 'Gate' },
    { value: 'bands', label: 'Bands' },
  ];
  const pct = (v: number): string => `${Math.round(v * 100)}%`;

  // --- Trigger-node source editor (U2) -------------------------------------------
  // The trigger node (graph root) declares what input fires its graph — a drum zone, a
  // raw MIDI note/CC, or an OSC address (U1's TriggerSource). Writes go through the U1
  // mutator store.setTriggerSource(<graph key>, source); the readout + the node sub-line
  // resolve via the pure describeTriggerSource helper. The graph key is store.selectedPadKey.
  const SOURCE_OPTS: Array<{ value: TriggerSource['kind']; label: string }> = [
    { value: 'drum', label: 'Drum' },
    { value: 'midi', label: 'MIDI' },
    { value: 'osc', label: 'OSC' },
  ];
  const MIDI_OPTS = [
    { value: 'note', label: 'Note' },
    { value: 'cc', label: 'CC' },
  ];
  const DRUM_OPTS = $derived(store.drums.map((d) => ({ value: d.id, label: d.label })));

  /** Zone <Select> options for a drum: the zones it exposes as pads (its hoops in use),
      always including the current binding, falling back to all four hoop labels. */
  function zoneOptsFor(drumId: string, current: string): Array<{ value: string; label: string }> {
    const ids: string[] = []; // ≤4 zones — a plain unique-push is plenty (no reactive Set)
    const add = (z: string): void => {
      if (z && !ids.includes(z)) ids.push(z);
    };
    for (const p of store.pads) if (p.drumId === drumId) add(String(p.zone));
    add(current);
    ids.sort((a, b) => Number(a) - Number(b));
    const list = ids.length ? ids : ZONE_LABELS.map((_, i) => String(i));
    return list.map((z) => ({ value: z, label: zoneLabel(z) }));
  }

  /** Switch the trigger source to a new kind, carrying compatible fields and filling
      least-surprising defaults (first drum + centre · middle MIDI note · empty address). */
  function setSourceKind(gkey: string, cur: TriggerSource | undefined, kind: TriggerSource['kind']): void {
    let next: TriggerSource;
    if (kind === 'drum') next = cur?.kind === 'drum' ? cur : { kind: 'drum', drumId: store.drums[0]?.id ?? '', zone: '0' };
    else if (kind === 'midi') next = cur?.kind === 'midi' ? cur : { kind: 'midi', note: 60 };
    else next = cur?.kind === 'osc' ? cur : { kind: 'osc', address: '' };
    store.setTriggerSource(gkey, next);
  }

  /** Flip a MIDI source between note and CC, carrying the current number across. */
  function setMidiMode(gkey: string, cur: Extract<TriggerSource, { kind: 'midi' }>, mode: 'note' | 'cc'): void {
    const n = cur.cc ?? cur.note ?? 0;
    store.setTriggerSource(gkey, mode === 'cc' ? { kind: 'midi', cc: n } : { kind: 'midi', note: n });
  }

  /** Rename an AUTHORED graph from its trigger node (editable-node parity). Pad graphs
      label from the kit; only `graph:<n>` keys live in graphNames. No store mutator owns
      this (U1 owns store.svelte.ts), so write the reactive record directly — the authored
      autosave persists it. An empty commit keeps the existing name. */
  function renameGraph(gkey: string, raw: string): void {
    const v = raw.trim();
    if (v) store.graphNames = { ...store.graphNames, [gkey]: v };
  }

  /** One-line description for the container/modifier kinds that take no extra control. */
  function kindBlurb(kind: NodeKind): string {
    switch (kind) {
      case 'all':
        return 'Plays every wired child at once.';
      case 'sequence':
        return 'Plays the next wired child on each hit, in order.';
      case 'toggle':
        return 'Alternates its child on / off with each hit.';
      default:
        return 'A container — wire its children on the canvas.';
    }
  }

  function num(v: ParamValue | undefined, d: number): number {
    return typeof v === 'number' ? v : d;
  }
  function fmt(spec: ParamSpec, v: ParamValue | undefined): string {
    if (typeof v === 'number') return `${spec.step && spec.step < 1 ? v.toFixed(2) : Math.round(v)}${spec.unit ?? ''}`;
    return v ? 'on' : 'off';
  }
</script>

<div class="inspector">
  {#if node && node.kind === 'trigger'}
    <!-- the graph's input — declares what fires it (source); kind/remove stay off-limits -->
    {@const src = node.source}
    {@const gkey = store.selectedPadKey}
    {@const kindNow = src?.kind ?? 'drum'}
    <header class="ihead">
      <div class="titles">
        <h3>
          {store.selectedPad
            ? `${store.selectedPad.drumLabel} · ${store.selectedPad.zoneLabel}`
            : gkey
              ? store.graphLabel(gkey)
              : 'Trigger'}
        </h3>
        <span class="sub">graph input</span>
      </div>
    </header>
    <div class="trigbody">
      <p class="hint">Every hit enters here — declare what fires this graph, then wire it to a block on the canvas.</p>
      <Field label="Trigger source">
        <SegmentedControl
          value={kindNow}
          options={SOURCE_OPTS}
          onChange={(v) => gkey && setSourceKind(gkey, src, v as TriggerSource['kind'])}
          ariaLabel="Trigger source"
        />
      </Field>

      {#if kindNow === 'drum'}
        {@const drumId = src?.kind === 'drum' ? src.drumId : store.drums[0]?.id ?? ''}
        {@const zone = src?.kind === 'drum' ? src.zone : '0'}
        <Field label="Drum">
          <Select
            value={drumId}
            options={DRUM_OPTS}
            onChange={(v) => gkey && store.setTriggerSource(gkey, { kind: 'drum', drumId: v, zone })}
            ariaLabel="Drum"
          />
        </Field>
        <Field label="Zone">
          <Select
            value={zone}
            options={zoneOptsFor(drumId, zone)}
            onChange={(v) => gkey && store.setTriggerSource(gkey, { kind: 'drum', drumId, zone: v })}
            ariaLabel="Zone"
          />
        </Field>
      {:else if src?.kind === 'midi'}
        {@const isCc = src.cc !== undefined}
        <Field label="Type">
          <SegmentedControl
            value={isCc ? 'cc' : 'note'}
            options={MIDI_OPTS}
            onChange={(v) => gkey && setMidiMode(gkey, src, v as 'note' | 'cc')}
            ariaLabel="MIDI note or CC"
          />
        </Field>
        <Field label={isCc ? 'CC number' : 'Note number'} hint="0–127">
          <CommitInput
            type="number"
            min={0}
            max={127}
            value={(isCc ? src.cc : src.note) ?? ''}
            placeholder="0–127"
            ariaLabel={isCc ? 'CC number' : 'Note number'}
            onCommit={(v) =>
              onNum(v, (n) => gkey && store.setTriggerSource(gkey, isCc ? { kind: 'midi', cc: n } : { kind: 'midi', note: n }))}
          />
        </Field>
        <p class="hint">Channel comes from the patch device, not here.</p>
      {:else if src?.kind === 'osc'}
        <Field label="Address" hint="e.g. /kick">
          <CommitInput
            value={src.address}
            mono
            placeholder="/kick"
            ariaLabel="OSC address"
            onCommit={(v) => gkey && store.setTriggerSource(gkey, { kind: 'osc', address: v.trim() })}
          />
        </Field>
        <p class="hint">Namespace / host comes from the patch device, not here.</p>
      {/if}

      <div class="readrow">
        <span class="k">Resolves to</span>
        <span class="rval">{describeTriggerSource(src, store.drums).sub}</span>
      </div>

      {#if gkey && gkey in store.graphNames}
        <Field label="Name" hint="display label">
          <CommitInput
            value={store.graphNames[gkey] ?? ''}
            placeholder="New graph"
            ariaLabel="Graph name"
            onCommit={(v) => renameGraph(gkey, v)}
          />
        </Field>
      {/if}
    </div>
  {:else if node}
    <!-- shared header for every editable node: change its kind + remove it -->
    <header class="nodehead">
      <span class="kindsel">
        <Select value={node.kind} options={KIND_OPTS} onChange={(v) => store.changeKind(node, v as NodeKind)} ariaLabel="Node type" />
      </span>
      <IconButton icon={Trash2} label="Remove node" variant="soft" size={14} onclick={() => store.removeNode(node)} />
    </header>

    {#if node.kind === 'play'}
      {#if eff}
        <header class="ihead">
          <div class="thumb"><EffectThumb pattern={eff.pattern} params={live} w={72} h={40} /></div>
          <div class="titles">
            <h3>{eff.name}</h3>
            <span class="sub">{eff.pattern} · {eff.scope}</span>
          </div>
          <IconButton icon={Replace} label="Change effect" variant="soft" size={14} onclick={() => store.openGallery(node)} />
        </header>

        <div class="bar">
          <label class="lblrow">
            <span class="k">Preset</span>
            <Select value={node.presetId} options={presetOptions} onChange={(v) => store.selectPreset(node, v)} ariaLabel="Preset" />
          </label>
          <SegmentedControl
            value={node.linked ? 'linked' : 'instance'}
            options={LINK_OPTS}
            onChange={(v) => {
              if ((v === 'linked') !== node.linked) store.toggleLink(node);
            }}
            ariaLabel="Instance or linked preset"
          />
        </div>

        <div class="seg2">
          <SegmentedControl value={node.mode} options={MODE_OPTS} onChange={(v) => store.setMode(node, v as 'oneshot' | 'loop' | 'hold')} ariaLabel="Play mode" />
          <SegmentedControl value={store.busOf(node)} options={LAYER_OPTS} onChange={(v) => store.setBus(node, v)} ariaLabel="Layer" />
        </div>

        <div class="params">
          {#each eff.params as spec (spec.key)}
            {@const enveloped = store.isEnveloped(node, spec.key)}
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
                  onChange={(v) => store.setParam(node, spec.key, v)}
                  ariaLabel={spec.label}
                />
              {:else}
                <Toggle pressed={live[spec.key] === true} onChange={(v) => store.setParam(node, spec.key, v)} ariaLabel={spec.label} class="boolcell" />
              {/if}
              {#if spec.envable}
                <button class="envbtn" class:on={enveloped} onclick={() => store.openEnv(node, spec.key)} title="Assign envelope">
                  <Spline size={12} aria-hidden="true" />
                  {store.envKind(node, spec.key)}
                </button>
              {:else}
                <span class="envspace"></span>
              {/if}
            </div>
          {/each}
        </div>

        <p class="foot">
          {node.linked ? 'Linked — edits change the shared preset everywhere.' : 'Instance — edits stay on this clip.'} Applies on the next hit.
        </p>
      {:else}
        <div class="kindbody">
          <p class="hint">This play node has no effect yet — change its kind above, or pick an effect from the canvas.</p>
        </div>
      {/if}
    {:else if node.kind === 'random'}
      <div class="kindbody">
        <label class="check">
          <input type="checkbox" checked={node.noRepeat} onchange={(e) => store.setNoRepeat(node, e.currentTarget.checked)} />
          No-repeat
        </label>
        <p class="hint">Picks a random wired child on each hit{node.noRepeat ? ', never the same one twice running' : ''}.</p>
      </div>
    {:else if node.kind === 'switch'}
      <div class="kindbody">
        <label class="lblrow">
          <span class="k">On</span>
          <Select value={node.on} options={SWITCH_OPTS} onChange={(v) => store.setSwitchOn(node, v as SwitchOn)} ariaLabel="Switch on" />
        </label>
        {#if node.on === 'value'}
          {@const mode = node.valueMode ?? 'gate'}
          <SegmentedControl value={mode} options={VALUEMODE_OPTS} onChange={(v) => store.setValueMode(node, v as ValueMode)} ariaLabel="Value mode" />
          {#if mode === 'gate'}
            {@const threshold = node.threshold ?? 0.5}
            {@const invert = node.invert ?? false}
            <label class="lblrow">
              <span class="k">Threshold</span>
              <span class="sld"><Slider min={0} max={1} step={0.01} value={threshold} onChange={(v) => store.setThreshold(node, v)} format={pct} ariaLabel="Gate threshold" /></span>
            </label>
            <label class="lblrow">
              <span class="k">Invert</span>
              <Toggle pressed={invert} onChange={(v) => store.setInvert(node, v)} ariaLabel="Invert gate" />
            </label>
            <p class="hint">
              {invert
                ? `Passes when value > ${pct(threshold)} — does nothing below.`
                : `Passes when value ≤ ${pct(threshold)} — does nothing above.`}
            </p>
          {:else}
            {@const cuts = node.bands && node.bands.length ? node.bands : [0.5]}
            <div class="bandlist">
              {#each cuts as cut, i (i)}
                <div class="bandrow">
                  <span class="bnum">{i + 1}</span>
                  <span class="k">≤</span>
                  <span class="sld"><Slider min={0} max={1} step={0.01} value={cut} onChange={(v) => store.setBandCutoff(node, i, v)} format={pct} ariaLabel={`Band ${i + 1} cutoff`} /></span>
                  <IconButton icon={Trash2} label="Remove band" variant="soft" size={13} disabled={cuts.length <= 1} onclick={() => store.removeBand(node, i)} />
                </div>
              {/each}
              <div class="bandrow rest">
                <span class="bnum">{cuts.length + 1}</span>
                <span class="restlabel">&gt; {pct(cuts[cuts.length - 1]!)} — the rest</span>
              </div>
              <button class="addband" type="button" onclick={() => store.addBand(node)}>
                <Plus size={13} aria-hidden="true" /> Add band
              </button>
            </div>
            <p class="hint">{cuts.length + 1} bands — wire a child to each band's handle on the node.</p>
          {/if}
        {:else}
          <p class="hint">Routes to a wired child by {node.on}.</p>
        {/if}
      </div>
    {:else if node.kind === 'chance'}
      <div class="kindbody">
        <label class="lblrow">
          <span class="k">Chance</span>
          <span class="sld">
            <Slider min={0} max={1} step={0.05} value={node.p} onChange={(v) => store.setChance(node, v)} format={(v) => `${Math.round(v * 100)}%`} />
          </span>
        </label>
        <p class="hint">Plays its wired child {Math.round(node.p * 100)}% of the time.</p>
      </div>
    {:else}
      <div class="kindbody">
        <p class="hint">{kindBlurb(node.kind)}</p>
      </div>
    {/if}
  {:else if bus}
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
  {:else if sel?.kind === 'patch' && ed}
    {@const editor = ed}
    {@const d = describePatchNode(sel.nodeId, store.drums)}

    {#snippet renameField(id: string, fallback: string)}
      <Field label="Name" hint="display label">
        <CommitInput
          value={patchLabel(id, fallback)}
          placeholder={fallback}
          ariaLabel="Node name"
          onCommit={(v) => commitLabel(id, fallback, v)}
        />
      </Field>
    {/snippet}

    {#snippet pixelRow(label: string, span: PixelSpan | null | undefined)}
      <div class="readrow">
        <span class="k">{label}</span>
        <span class="rval">{fmtSpan(span)}</span>
      </div>
    {/snippet}

    <header class="ihead">
      <div class="titles">
        <Eyebrow>{d.stage}</Eyebrow>
        <h3 class="patch-title">{patchLabel(sel.nodeId, d.title)}</h3>
        <span class="sub">{d.sub}</span>
      </div>
    </header>

    {#if editor.kind === 'input' || editor.kind === 'trigger' || editor.kind === 'unknown'}
      <div class="nodeinfo">
        <p class="hint">
          {editor.kind === 'trigger'
            ? 'The drum’s trigger input. What each hit plays is wired in the Trigger graph; the editable device settings live on its zone, drum and hoop nodes.'
            : 'The performance input source. What each hit plays is wired in the Trigger graph.'}
        </p>
      </div>
    {:else}
      <div class="patchbody">
        {#if !project}
          <p class="offline">Offline — connect to the engine to edit device settings. Renaming still works.</p>
        {/if}

        {#if editor.kind === 'zone'}
          {@const note = project ? zoneMidiNote(project.inputMap, editor.drumId, editor.slot) : null}
          {@const addr = project ? zoneOscAddress(project.inputMap, editor.drumId, editor.slot) : null}
          <p class="grouphint">What fires this zone — <b>{drumName(editor.drumId)}</b> · slot {editor.slot}.</p>
          <Field label="MIDI note" hint="0–127">
            <CommitInput
              type="number"
              min={0}
              max={127}
              value={note ?? ''}
              placeholder="none"
              disabled={!project}
              ariaLabel="MIDI note"
              onCommit={(v) =>
                v === '' ? setZoneNote(editor.drumId, editor.slot, null) : onNum(v, (n) => setZoneNote(editor.drumId, editor.slot, n))}
            />
          </Field>
          <Field label="OSC address" hint="Sensory Percussion / Ableton">
            <CommitInput
              value={addr ?? ''}
              mono
              placeholder="/drum/zone"
              disabled={!project}
              ariaLabel="OSC address"
              onCommit={(v) => setZoneOsc(editor.drumId, editor.slot, v.trim() ? v : null)}
            />
          </Field>
          {@render renameField(sel.nodeId, d.title)}
        {:else if editor.kind === 'drum' && patchDrum}
          {@const drum = patchDrum}
          <div class="vgroup">
            <span class="glabel">Origin <em>mm</em></span>
            <div class="axes">
              {#each ['x', 'y', 'z'] as const as ax (ax)}
                <CommitInput
                  type="number"
                  value={drum.origin[ax]}
                  disabled={!project}
                  suffix={ax}
                  ariaLabel={`Origin ${ax}`}
                  onCommit={(v) => onNum(v, (n) => setAxis(drum.id, 'origin', ax, n))}
                />
              {/each}
            </div>
          </div>
          <div class="vgroup">
            <span class="glabel">Rotation <em>deg</em></span>
            <div class="axes">
              {#each ['x', 'y', 'z'] as const as ax (ax)}
                <CommitInput
                  type="number"
                  value={drum.rotation[ax]}
                  disabled={!project}
                  suffix={ax}
                  ariaLabel={`Rotation ${ax}`}
                  onCommit={(v) => onNum(v, (n) => setAxis(drum.id, 'rotation', ax, n))}
                />
              {/each}
            </div>
          </div>
          <Field label="Starting angle" hint="all 4 hoops">
            <CommitInput
              type="number"
              value={drum.startAngleDeg}
              disabled={!project}
              suffix="°"
              ariaLabel="Starting angle"
              onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { startAngleDeg: n }))}
            />
          </Field>
          <Field label="Spin" hint="rotates pixel 0 around the hoop">
            <CommitInput
              type="number"
              value={drum.localSpinDeg}
              disabled={!project}
              suffix="°"
              ariaLabel="Spin"
              onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { localSpinDeg: n }))}
            />
          </Field>
          <Field label="Pixels per hoop" hint="literal LED count">
            <CommitInput
              type="number"
              min={1}
              value={pixelsForHoop({ drumId: drum.id, hoop: 0 })}
              disabled={!project}
              suffix="px"
              ariaLabel="Pixels per hoop"
              onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { pixelsPerHoop: n }))}
            />
          </Field>
          <Field label="Hoop spacing" hint="vertical gap between hoops">
            <CommitInput
              type="number"
              min={1}
              value={drum.hoopSpacingMm}
              disabled={!project}
              suffix="mm"
              ariaLabel="Hoop spacing"
              onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { hoopSpacingMm: n }))}
            />
          </Field>
          <Field label="Diameter" hint="drum size — sets ring radius">
            <CommitInput
              type="number"
              min={1}
              value={drum.diameterIn}
              disabled={!project}
              suffix="in"
              ariaLabel="Diameter"
              onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { diameterIn: n }))}
            />
          </Field>
          {@render renameField(sel.nodeId, d.title)}
        {:else if editor.kind === 'hoop' && patchDrum}
          {@const drum = patchDrum}
          {@const span = liveRouting ? hoopPixelSpan(liveRouting, { drumId: drum.id, hoop: editor.hoop }, pixelsForHoop) : null}
          <Field label="Pixels per hoop" hint="literal count · applies to every hoop on this drum">
            <CommitInput
              type="number"
              min={1}
              value={pixelsForHoop({ drumId: drum.id, hoop: editor.hoop })}
              disabled={!project}
              suffix="px"
              ariaLabel="Pixels per hoop"
              onCommit={(v) => onNum(v, (n) => store.setDrumTransform(drum.id, { pixelsPerHoop: n }))}
            />
          </Field>
          {@render pixelRow('First / last pixel', span)}
          {#if !span}<p class="hint">Wire this hoop into a data line on the canvas to give it pixels.</p>{/if}
          {@render renameField(sel.nodeId, d.title)}
        {:else if editor.kind === 'dataline'}
          {@const entry = orderedLines.find((o) => o.line.id === sel.nodeId)}
          {#if entry}
            <div class="readrow"><span class="k">Order</span><span class="rval">#{entry.pos} in transmit order</span></div>
            <div class="readrow">
              <span class="k">Output</span>
              <span class="rval">{patchLabel(`output:${entry.output.id}`, 'Output')} · {uLabel(entry.output.startUniverse)}</span>
            </div>
            {@render pixelRow('First / last pixel', ranges?.byDataLine[entry.line.id])}
            <Field label="Start universe" hint="blank = dense / auto">
              <CommitInput
                type="number"
                min={0}
                value={entry.line.startUniverse ?? ''}
                placeholder="dense"
                disabled={!project}
                ariaLabel="Data line start universe"
                onCommit={(v) =>
                  v === '' ? setDataLineUniverse(sel.nodeId, undefined) : onNum(v, (n) => setDataLineUniverse(sel.nodeId, n))}
              />
            </Field>
            <p class="hint">
              {entry.line.hoops.length} hoops. Re-order or re-wire on the Patch canvas — pixel order is what transmits; a start universe snaps this line to a hard boundary.
            </p>
          {:else}
            <p class="hint">
              A data line carries an ordered run of hoops to one output. Wire hoops into it on the canvas; its pixel span appears once the routing is saved.
            </p>
          {/if}
          {@render renameField(sel.nodeId, d.title)}
        {:else if editor.kind === 'output'}
          {#if patchOutput}
            {@const cfg = patchOutput}
            <p class="grouphint">A physical controller port. The controller owns universe offsets — leave blank to pack dense, or snap the port to a universe.</p>
            <Field label="Start universe" hint="blank = dense / auto">
              <CommitInput
                type="number"
                min={0}
                value={cfg.startUniverse ?? ''}
                placeholder="dense"
                disabled={!project}
                ariaLabel="Start universe"
                onCommit={(v) =>
                  v === '' ? setOutputScalar(cfg.id, { startUniverse: undefined }) : onNum(v, (n) => setOutputScalar(cfg.id, { startUniverse: n }))}
              />
            </Field>
            <Field label="Channels / pixel" hint="3 = RGB · 4 = RGBW">
              <CommitInput
                type="number"
                min={1}
                max={4}
                value={cfg.channelsPerPixel}
                disabled={!project}
                ariaLabel="Channels per pixel"
                onCommit={(v) => onNum(v, (n) => setOutputScalar(cfg.id, { channelsPerPixel: n }))}
              />
            </Field>
            {@render pixelRow('First / last pixel', ranges?.byOutput[cfg.id])}
          {:else}
            <p class="hint">
              A new output port. Wire data lines into it on the canvas to give it pixels — then its universe + channel settings appear here.
            </p>
          {/if}
          {@render renameField(sel.nodeId, d.title)}
        {:else if editor.kind === 'controller' && outputCfg}
          {@const out = outputCfg}
          <p class="grouphint">Art-Net / sACN transport — where the pixel stream is sent.</p>
          <Field label="Protocol">
            <Select
              value={out.protocol}
              options={PROTOCOL_OPTS}
              disabled={!project}
              onChange={(v) => store.setOutput({ protocol: v as 'artnet' | 'sacn' })}
              ariaLabel="Protocol"
            />
          </Field>
          <Field label="Host / IP" hint={out.broadcast ? 'broadcast / multicast target' : 'unicast target'}>
            <CommitInput
              value={out.host}
              mono
              placeholder="255.255.255.255"
              disabled={!project}
              ariaLabel="Host / IP"
              onCommit={(v) => v.trim() && store.setOutput({ host: v.trim() })}
            />
          </Field>
          <div class="tworow">
            <Field label="Port" hint={out.protocol === 'sacn' ? 'default 5568' : 'default 6454'}>
              <CommitInput
                type="number"
                min={1}
                max={65535}
                value={out.port ?? ''}
                placeholder={out.protocol === 'sacn' ? '5568' : '6454'}
                disabled={!project}
                ariaLabel="Output port"
                onCommit={(v) => onNum(v, (n) => store.setOutput({ port: n }))}
              />
            </Field>
            <Field label="Interface" hint="source NIC · blank = default">
              <CommitInput
                value={out.iface ?? ''}
                mono
                placeholder="0.0.0.0"
                disabled={!project}
                ariaLabel="Source interface"
                onCommit={(v) => store.setOutput({ iface: v.trim() })}
              />
            </Field>
          </div>
          <div class="tworow">
            <Field label="RGB order">
              <Select
                value={out.rgbOrder}
                options={RGB_OPTS}
                disabled={!project}
                onChange={(v) => store.setOutput({ rgbOrder: v as RgbOrder })}
                ariaLabel="RGB order"
              />
            </Field>
            <Field label="FPS" hint="≤ 120">
              <CommitInput
                type="number"
                min={1}
                max={120}
                value={out.fps}
                disabled={!project}
                suffix="fps"
                ariaLabel="Output FPS"
                onCommit={(v) => onNum(v, (n) => store.setOutput({ fps: n }))}
              />
            </Field>
          </div>
          <label class="checkrow">
            <Toggle
              pressed={out.broadcast}
              disabled={!project}
              onChange={(v) => store.setOutput({ broadcast: v })}
              ariaLabel={out.protocol === 'sacn' ? 'Multicast' : 'Broadcast'}
            />
            <span>{out.protocol === 'sacn' ? 'Multicast' : 'Broadcast'}</span>
          </label>
          {#if out.protocol === 'sacn'}
            <Field label="Priority" hint="1–200 · higher wins at a merge">
              <CommitInput
                type="number"
                min={1}
                max={200}
                value={out.priority}
                disabled={!project}
                ariaLabel="sACN priority"
                onCommit={(v) => onNum(v, (n) => store.setOutput({ priority: n }))}
              />
            </Field>
          {/if}
          {@render renameField(sel.nodeId, d.title)}
        {/if}
      </div>
    {/if}
  {:else}
    <div class="empty">
      <MousePointerClick size={22} aria-hidden="true" />
      <p>Select a node, a bus, or a device to edit it here.</p>
    </div>
  {/if}
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow: auto;
  }
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
    padding: 2px;
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
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-size: var(--text-2xs);
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
  /* shared node header: kind selector (grows) + remove button */
  .nodehead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .kindsel {
    display: inline-flex;
    flex: 1;
    min-width: 0;
  }
  .kindsel :global(.sel-trigger) {
    font-weight: 700;
    color: var(--ink);
  }
  /* per-kind body (random / switch / chance / container blurb) */
  .kindbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .kindbody .lblrow {
    justify-content: space-between;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text);
  }
  /* value-switch band editor (one row per cutoff + the implicit "rest" band) */
  .bandlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .bandrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .bandrow .sld {
    flex: 1;
    max-width: none;
  }
  .bnum {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-pill);
  }
  .bandrow.rest {
    color: var(--text-faint);
  }
  .restlabel {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  .addband {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-1);
    transition:
      color 120ms ease,
      border-color 120ms ease;
  }
  .addband:hover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
  }
  .addband:active {
    scale: 0.98;
  }
  @media (prefers-reduced-motion: reduce) {
    .addband {
      transition: none;
    }
  }
  .params {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .prow {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr) auto;
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
    padding: var(--space-3);
    border-top: 1px solid var(--border-faint);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .busbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .busbody .lblrow {
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
  .nodeinfo {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  /* trigger-node source editor (U2): segmented kind + per-mode fields + readout */
  .trigbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .trigbody :global(.sel) {
    width: 100%;
  }
  /* --- Patch graph per-node editors (S4) ----------------------------------- */
  .patchbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .patchbody :global(.sel) {
    width: 100%;
  }
  .offline {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    background: var(--surface-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius-2);
  }
  .grouphint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  .grouphint b {
    color: var(--text);
    font-weight: 600;
  }
  .vgroup {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .glabel {
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .glabel em {
    font-style: normal;
    color: var(--text-faint);
    margin-left: 4px;
  }
  .axes {
    display: flex;
    gap: var(--space-2);
  }
  .axes :global(.ci) {
    flex: 1;
    min-width: 0;
  }
  .tworow {
    display: flex;
    gap: var(--space-3);
  }
  .tworow :global(.field) {
    flex: 1;
    min-width: 0;
  }
  .readrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 4px 0;
    border-bottom: 1px solid var(--border-faint);
  }
  .rval {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--text);
    font-variant-numeric: tabular-nums;
    text-align: right;
    min-width: 0;
  }
  .checkrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4);
    text-align: center;
    color: var(--text-faint);
  }
  .empty p {
    margin: 0;
    font-size: var(--text-xs);
    max-width: 28ch;
  }
  @media (prefers-reduced-motion: reduce) {
    .meter span {
      transition: none;
    }
  }
</style>
