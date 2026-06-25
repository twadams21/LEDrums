<script lang="ts">
  /* Right-dock Inspector — contextual settings for whatever is selected in the
     shell (a trigger-graph node, a layer/bus, or a Patch device). There is no
     separate Settings page; switching views resets the selection. Effect Gallery,
     Envelope Editor and Effect Creator stay as summoned overlays — opened from
     here via the engine store. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { GraphNode, ParamSpec, ParamValue, Polyphony } from '../../trigger-lab/sim';
  import EffectThumb from '../../trigger-lab/EffectThumb.svelte';
  import Slider from '../../ui/Slider.svelte';
  import Select from '../../ui/Select.svelte';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Replace from '@lucide/svelte/icons/replace';
  import Spline from '@lucide/svelte/icons/spline';
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

  const MODE_OPTS = [
    { value: 'oneshot', label: 'One-shot' },
    { value: 'loop', label: 'Loop' },
    { value: 'hold', label: 'Hold' },
  ];
  const LAYER_OPTS = $derived(store.buses.map((b) => ({ value: b.id, label: b.name })));
  const LINK_OPTS = [
    { value: 'instance', label: 'Instance' },
    { value: 'linked', label: 'Linked' },
  ];
  const POLY_OPTS = [
    { value: 'mono', label: 'mono' },
    { value: 'poly', label: 'poly' },
  ];

  function num(v: ParamValue | undefined, d: number): number {
    return typeof v === 'number' ? v : d;
  }
  function fmt(spec: ParamSpec, v: ParamValue | undefined): string {
    if (typeof v === 'number') return `${spec.step && spec.step < 1 ? v.toFixed(2) : Math.round(v)}${spec.unit ?? ''}`;
    return v ? 'on' : 'off';
  }
</script>

<div class="inspector">
  {#if node && node.kind === 'play' && eff}
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
  {:else if node}
    <div class="nodeinfo">
      <Eyebrow>{node.kind} node</Eyebrow>
      <p class="hint">
        {#if node.kind === 'trigger'}This is the graph's input — every hit enters here.{:else}A {node.kind} container. Wire it on the canvas; its leaf Play nodes carry the effect settings.{/if}
      </p>
    </div>
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
    <div class="nodeinfo">
      <Eyebrow>{sel.nodeId}</Eyebrow>
      <p class="hint">Patch device settings load here. (Wiring lands with the Patch Graph view.)</p>
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
