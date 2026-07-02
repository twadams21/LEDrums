<script lang="ts">
  /* The graph system, LIVE: the real GraphCanvas (shared SvelteFlow chrome + token
     theming), GraphPalette, WireEdge and NodeCard — wired to demo data. Drag nodes,
     hover to light connected wires, drag handles to wire, Delete to remove, add
     kinds from the palette. The locked interaction contract is printed below. */
  import type { Edge, Node } from '@xyflow/svelte';
  import GraphCanvas from '../../app/views/GraphCanvas.svelte';
  import GraphPalette from '../../app/views/GraphPalette.svelte';
  import ModifierPalette from '../../app/views/ModifierPalette.svelte';
  import WireEdge from '../../app/views/WireEdge.svelte';
  import GraphDemoNode from '../GraphDemoNode.svelte';
  import { GraphHover } from '../../app/views/graph-hover.svelte';
  import { kindIcon, tint, kindLabel, modifierName } from '../../app/views/trigger-node-meta';
  import { nodeHasInput, nodeHasOutput, type NodeKind } from '../../trigger-lab/sim';
  import DemoCard from '../DemoCard.svelte';

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
  ]);
  let edges = $state<Edge[]>([
    { id: 'e1', source: 't', target: 'r', type: 'wire' },
    { id: 'e2', source: 'r', target: 'p1', type: 'wire' },
    { id: 'e3', source: 'r', target: 'd', type: 'wire' },
    { id: 'e4', source: 'd', target: 'p2', type: 'wire' },
    { id: 'e5', source: 'm', target: 'p2', targetHandle: 'mod', type: 'wire', data: { mod: true } },
  ]);

  const hover = new GraphHover();
  function restamp(): void {
    edges = hover.decorate(edges);
  }

  // Modifiers are added from the dedicated ModifierPalette (category-grouped over the registry),
  // so they're dropped from the flat kind palette — mirroring the real Trigger graph.
  const paletteKinds: NodeKind[] = ['play', 'all', 'random', 'sequence', 'switch', 'chance', 'toggle', 'delay'];
  const paletteItems = paletteKinds.map((k) => ({
    key: k,
    label: kindLabel[k],
    icon: kindIcon[k],
    tint: tint[k],
  }));

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
    title="Canvas · palette · wires"
    src={[
      'lib/app/views/GraphCanvas',
      'lib/app/views/GraphPalette',
      'lib/app/views/ModifierPalette',
      'lib/app/views/WireEdge',
      'lib/app/views/graph-hover.svelte',
    ]}
    wide
  >
    <div class="canvas-demo">
      <GraphCanvas
        bind:nodes
        bind:edges
        nodeTypes={{ demo: GraphDemoNode }}
        edgeTypes={{ wire: WireEdge }}
        defaultEdgeOptions={{ type: 'wire' }}
        fitPadding={0.25}
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
      >
        {#snippet palette()}
          <div class="palette-stack">
            <GraphPalette items={paletteItems} {add} ariaLabel="Add demo node" />
            <ModifierPalette add={addMod} />
          </div>
        {/snippet}
      </GraphCanvas>
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
      <li><strong>Modifiers add by category.</strong> The <code>ModifierPalette</code> lists every registered modifier grouped by category with a filter (<code>listModifiersByCategory()</code> — dynamic over the registry, never a hardcoded id list), so new modifiers appear automatically.</li>
      <li><strong>Delete / Backspace</strong> removes the selection; the palette adds at the visible canvas centre.</li>
    </ul>
  </div>
</section>

<style>
  .canvas-demo {
    height: 360px;
  }
  .palette-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
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
