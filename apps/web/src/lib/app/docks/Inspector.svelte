<script lang="ts">
  /* Right-dock Inspector — contextual settings for whatever is selected in the
     shell (a trigger-graph node, a layer/bus, or a Patch device). There is no
     separate Settings page; switching views resets the selection. Effect Gallery,
     Envelope Editor and Effect Creator stay as summoned overlays — opened from
     here via the engine store. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { describePatchNode } from '../patch-topology';
  import {
    NODE_KINDS,
    type GraphNode,
    type NodeKind,
    type ParamSpec,
    type ParamValue,
    type Polyphony,
    type SwitchOn,
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
    { value: 'velocity', label: 'velocity' },
    { value: 'section', label: 'section' },
    { value: 'beat', label: 'beat' },
    { value: 'value', label: 'value' },
  ];
  const VALUEMODE_OPTS: Array<{ value: ValueMode; label: string }> = [
    { value: 'gate', label: 'Gate' },
    { value: 'bands', label: 'Bands' },
  ];
  const pct = (v: number): string => `${Math.round(v * 100)}%`;

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
    <!-- the graph's input — read-only (no kind change, no remove) -->
    <header class="ihead">
      <div class="titles">
        <h3>{store.selectedPad ? `${store.selectedPad.drumLabel} · ${store.selectedPad.zoneLabel}` : 'Trigger'}</h3>
        <span class="sub">graph input</span>
      </div>
    </header>
    <div class="nodeinfo">
      <p class="hint">Every hit enters here. Wire it to a block on the canvas to shape what plays.</p>
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
  {:else if sel?.kind === 'patch'}
    {@const d = describePatchNode(sel.nodeId, store.drums)}
    <div class="nodeinfo">
      <Eyebrow>{d.stage}</Eyebrow>
      <h3 class="patch-title">{d.title}</h3>
      <p class="hint">
        {d.sub}. Device settings (universes, ports, IP) are read-only for now — editing lands in a later slice.
      </p>
    </div>
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
