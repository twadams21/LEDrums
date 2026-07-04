<script lang="ts">
  /* The graph system, LIVE: the real GraphCanvas (shared SvelteFlow chrome + token
     theming), the Node Editor drawer (Add palette + Inspector tabs), WireEdge and
     NodeCard — wired to demo data. Drag nodes, hover to light connected wires, drag
     handles to wire, Delete to remove, add kinds from the drawer's Add tab. The
     locked interaction contract is printed below. */
  import type { Edge, Node } from '@xyflow/svelte';
  import GraphCanvas from '../../app/views/GraphCanvas.svelte';
  import NodeEditor from '../../app/views/NodeEditor.svelte';
  import AddPalette, { type AddGroup } from '../../app/views/AddPalette.svelte';
  import type { FlowApi } from '../../app/views/FlowHandle.svelte';
  import WireEdge from '../../app/views/WireEdge.svelte';
  import GraphDemoNode from '../GraphDemoNode.svelte';
  import { GraphHover } from '../../app/views/graph-hover.svelte';
  import { kindIcon, tint, kindLabel, modifierName } from '../../app/views/trigger-node-meta';
  import { nodeHasInput, nodeHasOutput, type NodeKind } from '../../trigger-lab/sim';
  import { listModifiersByCategory } from '@ledrums/core';
  import Blend from '@lucide/svelte/icons/blend';
  import DemoCard from '../DemoCard.svelte';
  import NodeSignalPreview from '../../app/views/NodeSignalPreview.svelte';
  import ParamRowTick from '../../app/views/ParamRowTick.svelte';
  import { paramRowSignal, previewCtx } from '../../trigger-lab/signal-preview';
  import { voice } from '@ledrums/core';

  // S38 signal-preview demo inputs — real core data, sampled by the previews through core.
  const demoEnv = voice.defaultEnvelope('decay');
  const demoLfo: voice.LfoSettings = { ...voice.defaultLfoSettings(), waveform: 'triangle', rateHz: 0.7 };
  // A gently wobbling synthetic CC so the live bar + param tick visibly move in the styleguide
  // (the real bar reads the engine CC table; this stand-in keeps the demo honest about "live").
  const demoCcTable = new Map<string, number>();
  const demoCc = (): number => {
    const v = 0.5 + 0.5 * Math.sin(performance.now() / 900);
    demoCcTable.set(voice.ccKey(1, null), v);
    return v;
  };
  const demoSources = [{ source: { kind: 'lfo', lfo: demoLfo } as voice.ModSource, invert: false }];
  const demoTick = (tMs: number): number => paramRowSignal(demoSources, previewCtx(tMs, 120, demoCcTable));

  const face = (kind: NodeKind, sub: string) => ({
    icon: kindIcon[kind],
    title: kindLabel[kind],
    sub,
    tint: tint[kind],
    hasInput: nodeHasInput(kind),
    hasOutput: nodeHasOutput(kind),
    // play + modifier nodes take a modifier chain on a distinct `mod` input handle
    hasMod: kind === 'play' || kind === 'modifier',
  });

  let nodes = $state<Node[]>([
    { id: 't', type: 'demo', position: { x: 0, y: 90 }, data: face('trigger', 'kick · center') },
    { id: 'r', type: 'demo', position: { x: 250, y: 90 }, data: face('random', 'no-repeat') },
    { id: 'p1', type: 'demo', position: { x: 500, y: 20 }, data: { ...face('play', 'Soft strike'), title: 'Chase' } },
    { id: 'd', type: 'demo', position: { x: 500, y: 160 }, data: face('delay', '1/8 dotted') },
    { id: 'p2', type: 'demo', position: { x: 750, y: 160 }, data: { ...face('play', 'Shimmer'), title: 'Sparkle' } },
    // a modifier node wired into a play node's mod input — the dashed mod wire reads distinctly
    { id: 'm', type: 'demo', position: { x: 250, y: 260 }, data: { ...face('modifier', 'add · smear'), title: 'Trail' } },
    // a modulation SOURCE (envelope) wired into a play node's exposed param — the dotted mod wire
    { id: 'env', type: 'demo', position: { x: 250, y: 380 }, data: { ...face('envelope', 'modulation source'), title: 'Envelope' } },
  ]);
  let edges = $state<Edge[]>([
    { id: 'e1', source: 't', target: 'r', type: 'wire' },
    { id: 'e2', source: 'r', target: 'p1', type: 'wire' },
    { id: 'e3', source: 'r', target: 'd', type: 'wire' },
    { id: 'e4', source: 'd', target: 'p2', type: 'wire' },
    { id: 'e5', source: 'm', target: 'p2', targetHandle: 'mod', type: 'wire', data: { mod: true } },
    { id: 'e6', source: 'env', target: 'p1', type: 'wire', data: { modulation: true } },
  ]);

  const hover = new GraphHover();
  function restamp(): void {
    edges = hover.decorate(edges);
  }

  // Node Editor drawer Add groups — node kinds, modulation sources, then the modifier
  // registry grouped by category (same shape the real Trigger graph builds).
  const paletteKinds: NodeKind[] = ['play', 'all', 'random', 'sequence', 'switch', 'chance', 'toggle', 'delay'];
  const modSourceKinds: NodeKind[] = ['envelope', 'lfo', 'cc'];
  const MODIFIER_GROUP_PREFIX = 'modifier:';
  const addGroups = $derived<AddGroup[]>([
    {
      key: 'kinds',
      label: 'Nodes',
      items: paletteKinds.map((k) => ({ id: k, name: kindLabel[k], icon: kindIcon[k], tint: tint[k] })),
    },
    {
      key: 'modulation',
      label: 'Modulation',
      items: modSourceKinds.map((k) => ({ id: k, name: kindLabel[k], icon: kindIcon[k], tint: tint[k] })),
    },
    ...listModifiersByCategory().map((g) => ({
      key: `${MODIFIER_GROUP_PREFIX}${g.category}`,
      label: `Modifiers · ${g.label}`,
      items: g.modifiers.map((m) => ({ id: m.id, name: m.name, icon: Blend, tint: 'var(--role-mod)' })),
    })),
  ]);

  // Placement: the drawer adds at the visible canvas centre via the flow instance
  // (FlowHandle) — the same mechanism the real views use.
  let flowApi = $state<FlowApi | null>(null);
  let canvasWrap = $state<HTMLElement | null>(null);
  function demoCentre(): { x: number; y: number } {
    const r = canvasWrap?.getBoundingClientRect();
    if (!flowApi) return { x: 0, y: 0 };
    return flowApi.screenToFlowPosition(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 });
  }
  function handleAdd(id: string, groupKey: string): void {
    const c = demoCentre();
    if (groupKey.startsWith(MODIFIER_GROUP_PREFIX)) addMod(id, c.x, c.y);
    else add(id as NodeKind, c.x, c.y);
  }

  let nid = 0;
  const demoSubs: Partial<Record<NodeKind, string>> = {
    play: 'from palette',
    all: 'all at once',
    random: 'repeat',
    sequence: 'in order',
    switch: 'on value',
    chance: '45%',
    toggle: 'on · off',
    delay: '120ms',
  };
  function add(kind: NodeKind, cx: number, cy: number): void {
    nodes = [
      ...nodes,
      {
        id: `n${++nid}`,
        type: 'demo',
        position: { x: cx - 88, y: cy - 24 },
        data: face(kind, demoSubs[kind] ?? ''),
      },
    ];
  }
  /** Add a modifier node from the category palette (titled with the registry display name). */
  function addMod(modifierId: string, cx: number, cy: number): void {
    nodes = [
      ...nodes,
      {
        id: `n${++nid}`,
        type: 'demo',
        position: { x: cx - 88, y: cy - 24 },
        data: { ...face('modifier', 'modifier'), title: modifierName(modifierId) },
      },
    ];
  }
</script>

<section class="block" id="graph">
  <div class="block-head">
    <h2>Graph system</h2>
    <p>
      Live — the real canvas chrome, palette, node face and wires. Drag, hover, wire
      handle-to-handle, Delete a selection, add kinds from the palette.
    </p>
  </div>

  <DemoCard
    title="Canvas · Node Editor drawer · wires"
    src={[
      'lib/app/views/GraphCanvas',
      'lib/app/views/NodeEditor',
      'lib/app/views/AddPalette',
      'lib/app/views/WireEdge',
      'lib/app/views/graph-hover.svelte',
    ]}
    wide
  >
    <div class="canvas-demo">
      <div class="canvas-cell" bind:this={canvasWrap}>
        <GraphCanvas
          bind:nodes
          bind:edges
          nodeTypes={{ demo: GraphDemoNode }}
          edgeTypes={{ wire: WireEdge }}
          defaultEdgeOptions={{ type: 'wire' }}
          fitPadding={0.25}
          onFlow={(f) => (flowApi = f)}
          onNodeEnter={(id) => {
            hover.enter(id);
            restamp();
          }}
          onNodeLeave={() => {
            hover.leave();
            restamp();
          }}
          onConnect={(c) => {
            edges = [...edges, { id: `e${c.source}-${c.target}-${++nid}`, source: c.source, target: c.target, type: 'wire' }];
          }}
        />
      </div>
      <NodeEditor>
        {#snippet add()}
          <AddPalette groups={addGroups} onAdd={handleAdd} />
        {/snippet}
        {#snippet inspector()}
          <p class="insp-hint">In the app, the selected node's editor mounts here (see the Trigger / Patch views).</p>
        {/snippet}
      </NodeEditor>
    </div>
  </DemoCard>

  <DemoCard
    title="Signal previews · node-face live ticks"
    src={[
      'lib/app/views/NodeSignalPreview',
      'lib/app/views/ParamRowTick',
      'lib/trigger-lab/SignalFace',
      'lib/trigger-lab/signal-preview',
    ]}
  >
    <div class="sig-demo">
      <div class="sig-cell">
        <NodeSignalPreview kind="envelope" env={demoEnv} />
        <span class="sig-label">Envelope · shape + phase cursor</span>
      </div>
      <div class="sig-cell">
        <NodeSignalPreview kind="lfo" lfo={demoLfo} bpm={120} />
        <span class="sig-label">LFO · waveform + moving phase</span>
      </div>
      <div class="sig-cell">
        <NodeSignalPreview kind="cc" ccValue={demoCc} />
        <span class="sig-label">CC · live value bar + readout</span>
      </div>
      <div class="sig-cell">
        <span class="sig-row"><span class="sig-plabel">brightness</span><ParamRowTick sample={demoTick} /></span>
        <span class="sig-label">Param row · live value tick</span>
      </div>
    </div>
  </DemoCard>

  <div class="contract">
    <h3>The locked graph interaction contract</h3>
    <ul>
      <li><strong>No node lift / click motion.</strong> Hover changes the border colour only — the node never moves under the pointer (motion detaches handles mid-wire).</li>
      <li><strong>Instant hover.</strong> Hovering a node lights its border AND every wire one level connected — no delay, no transition lag (<code>graph-hover.svelte.ts</code> stamps <code>edge-hot</code>).</li>
      <li><strong>Selection ≠ hover.</strong> A selected node rings (crisp 1px accent ring); its wires do NOT light. Only hover lights wires.</li>
      <li><strong>Drop anywhere on a node → its input.</strong> In the app views a wire dropped on the node body (not just the handle) connects to its target handle via a DOM hit-test (<code>TriggerGraphView</code>/<code>PatchGraphView</code> — xyflow alone only connects near a handle; this demo shows handle-drop only).</li>
      <li><strong>Rejected rewires keep the wire.</strong> The store validates reconnects; an invalid drop restores the original wire instead of deleting it.</li>
      <li><strong>Per-band handles.</strong> A value+bands switch emits one source handle per band (<code>band-&#123;i&#125;</code>) so each band wires a different child (<code>BandSwitchNode</code>).</li>
      <li><strong>Modifier wires read distinctly.</strong> A modifier node (media-effect: Trail / Bloom…) wires to a play/modifier <code>mod</code> input — a dashed <code>--role-mod</code> wire, separate from trigger-flow wires. Drop-anywhere routes by source kind: a wire from a modifier lands on the target's <code>mod</code> input.</li>
      <li><strong>Modulation wires are a third role.</strong> A modulation source (Envelope / LFO / CC) wires from its output into a target's exposed <code>param:&#123;key&#125;</code> row — a dotted <code>--role-modulation</code> wire, distinct from both flow and modifier wires. Params are exposed target-side (the Inspector's Parameters section); each exposed param is its own node-face row + scoped input handle, and drop-anywhere from a source lands on a param row.</li>
      <li><strong>Sources preview their signal on the node face.</strong> Envelope/LFO/CC nodes draw a live preview (shape + phase cursor, waveform, value bar) and each exposed param row shows a live value tick — all sampled through core (<code>signal-preview.ts</code>) and driven by the ONE shared thumbnail ticker (<code>SignalFace</code>), viewport-gated, reduced-motion → a static frame. The signal animates; the chrome never does.</li>
      <li><strong>Adding lives in the Node Editor drawer.</strong> The drawer beside the canvas has two tabs: <strong>Add</strong> — ONE searchable, grouped palette of node kinds, modulation sources, and the modifier registry by category (<code>listModifiersByCategory()</code> — dynamic over the registry, never a hardcoded id list); <strong>Inspector</strong> — the selected node's editor. Selecting a node flips the drawer to Inspector; clicking an Add item spawns at a free spot near the visible canvas centre. Nothing floats over the canvas.</li>
      <li><strong>Delete / Backspace</strong> removes the selection.</li>
    </ul>
  </div>
</section>

<style>
  .canvas-demo {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    height: 400px;
  }
  .canvas-cell {
    min-width: 0;
    min-height: 0;
  }
  .insp-hint {
    margin: 0;
    padding: var(--space-4);
    font-size: var(--text-xs);
    color: var(--text-faint);
    line-height: var(--leading-normal);
  }
  /* S38 signal-preview demo grid */
  .sig-demo {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    padding: var(--space-3);
  }
  .sig-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-start;
  }
  .sig-label {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .sig-row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-1);
  }
  .sig-plabel {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .contract {
    margin-top: var(--space-5);
  }
  h3 {
    font-size: var(--text-sm);
    color: var(--text);
    margin-bottom: var(--space-3);
  }
  ul {
    margin: 0;
    padding-left: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  li {
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  li strong {
    color: var(--text);
  }
  li code {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
</style>
