<script lang="ts">
  /* Freeform node-graph editor for the per-pad trigger graph. The model is an
     explicit GRAPH (store.selectedGraph): nodes carry their own world x/y and
     edges wire output→input. Three interactions: drag a node to rearrange it,
     pan only when the empty canvas is grabbed, and hand-wire ports into bezier
     edges (deletable by clicking the wire). Pan/zoom math is reused from the
     old auto-layout NodeCanvas. Throwaway prototype. */
  import EffectThumb from './EffectThumb.svelte';
  import Slider from '../ui/Slider.svelte';
  import Select from '../ui/Select.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import X from '@lucide/svelte/icons/x';
  import Replace from '@lucide/svelte/icons/replace';
  import Plus from '@lucide/svelte/icons/plus';
  import Minus from '@lucide/svelte/icons/minus';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import Zap from '@lucide/svelte/icons/zap';
  import Repeat from '@lucide/svelte/icons/repeat';
  import Hand from '@lucide/svelte/icons/hand';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Layers from '@lucide/svelte/icons/layers';
  import Shuffle from '@lucide/svelte/icons/shuffle';
  import ListOrdered from '@lucide/svelte/icons/list-ordered';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Dices from '@lucide/svelte/icons/dices';
  import Power from '@lucide/svelte/icons/power';
  import Disc3 from '@lucide/svelte/icons/disc-3';
  import Activity from '@lucide/svelte/icons/activity';
  import Wand2 from '@lucide/svelte/icons/wand-2';
  import { type Component } from 'svelte';
  import {
    NODE_KINDS,
    NODE_W,
    nodeHasInput,
    nodeHasOutput,
    type BlockKind,
    type GraphNode,
    type NodeKind,
    type PlayMode,
    type SwitchOn,
  } from './sim';
  import type { TriggerLab } from './store.svelte';

  /* `onSelect` + `selectedId` are optional: the unified shell passes them to load
     a clicked node into the right-dock Inspector and highlight it. Standalone use
     (the lab) omits them — node editing then flows only through the drawers. */
  let {
    store,
    onSelect,
    selectedId,
  }: {
    store: TriggerLab;
    onSelect?: (node: GraphNode) => void;
    selectedId?: string;
  } = $props();

  // ---- node + port geometry --------------------------------------------------

  /** Approximate node height — only used to anchor ports + edge endpoints. The
      DOM node grows to fit; ports sit at a fixed vertical offset from the top. */
  const PORT_Y = 26; // px from a node's top to its port row (header band)

  /** Icon per node kind (used in the add palette, node title, and dropdown). */
  const kindIcon: Record<NodeKind, Component> = {
    trigger: Zap,
    play: Sparkles,
    all: Layers,
    random: Shuffle,
    sequence: ListOrdered,
    switch: GitBranch,
    chance: Dices,
    toggle: Power,
  };
  /** Icon per layer/bus (the layer router segment + the lanes). */
  const busIcon: Record<string, Component> = {
    base: Disc3,
    trigger: Activity,
    effect: Wand2,
  };

  /** Type colour per node kind — drives the node border + dropdown icons. */
  const tint: Record<NodeKind, string> = {
    trigger: 'var(--accent)',
    play: 'var(--role-content)',
    all: 'var(--role-layer)',
    random: 'var(--role-effect)',
    sequence: 'var(--role-output)',
    switch: 'var(--role-input)',
    chance: 'var(--role-mod)',
    toggle: 'var(--accent)',
  };

  const KINDS: Array<{ value: BlockKind; label: string; icon: Component; iconColor: string }> = [
    { value: 'play', label: 'Play', icon: kindIcon.play, iconColor: tint.play },
    { value: 'all', label: 'All', icon: kindIcon.all, iconColor: tint.all },
    { value: 'random', label: 'Random', icon: kindIcon.random, iconColor: tint.random },
    { value: 'sequence', label: 'Sequence', icon: kindIcon.sequence, iconColor: tint.sequence },
    { value: 'switch', label: 'Switch', icon: kindIcon.switch, iconColor: tint.switch },
    { value: 'chance', label: 'Chance', icon: kindIcon.chance, iconColor: tint.chance },
    { value: 'toggle', label: 'Toggle', icon: kindIcon.toggle, iconColor: tint.toggle },
  ];
  const PALETTE: Array<{ kind: BlockKind; label: string }> = NODE_KINDS.map((k) => ({
    kind: k,
    label: KINDS.find((o) => o.value === k)?.label ?? k,
  }));
  const MODE_OPTS = [
    { value: 'oneshot', label: 'One-shot', icon: Zap },
    { value: 'loop', label: 'Loop', icon: Repeat },
    { value: 'hold', label: 'Hold', icon: Hand },
  ];
  const SWITCH_OPTS: Array<{ value: SwitchOn; label: string }> = [
    { value: 'velocity', label: 'velocity' },
    { value: 'section', label: 'section' },
    { value: 'beat', label: 'beat' },
  ];
  /** Layer router options (base / trigger / effect), each with an icon. */
  const LAYER_OPTS = $derived(store.buses.map((b) => ({ value: b.id, label: b.name, icon: busIcon[b.id] })));

  const eyebrow: Record<NodeKind, string> = {
    trigger: 'Trigger',
    play: 'Play',
    all: 'All',
    random: 'Random',
    sequence: 'Sequence',
    switch: 'Switch',
    chance: 'Chance',
    toggle: 'Toggle',
  };

  // ---- pan / zoom (reused from the old NodeCanvas) ---------------------------

  let viewport = $state<HTMLDivElement>();
  /** Capture the canvas element (read in pan/zoom math + getBoundingClientRect). */
  function bindViewport(el: HTMLDivElement): () => void {
    viewport = el;
    return () => {
      if (viewport === el) viewport = undefined;
    };
  }
  let zoom = $state(1);
  let panX = $state(120);
  let panY = $state(160);

  const MIN = 0.3;
  const MAX = 2.5;
  const clampZoom = (z: number): number => Math.min(MAX, Math.max(MIN, z));

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = viewport?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const next = clampZoom(zoom * (1 - e.deltaY * 0.0015));
    // keep the world point under the cursor fixed while zooming
    const wx = (cx - panX) / zoom;
    const wy = (cy - panY) / zoom;
    panX = cx - wx * next;
    panY = cy - wy * next;
    zoom = next;
  }

  function zoomBy(factor: number): void {
    const rect = viewport?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    const next = clampZoom(zoom * factor);
    const wx = (cx - panX) / zoom;
    const wy = (cy - panY) / zoom;
    panX = cx - wx * next;
    panY = cy - wy * next;
    zoom = next;
  }
  function reset(): void {
    zoom = 1;
    panX = 120;
    panY = 160;
  }

  /** Screen point (clientX/Y) → world coordinates, given current pan/zoom. */
  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = viewport?.getBoundingClientRect();
    const lx = clientX - (rect?.left ?? 0);
    const ly = clientY - (rect?.top ?? 0);
    return { x: (lx - panX) / zoom, y: (ly - panY) / zoom };
  }

  // ---- interaction state -----------------------------------------------------

  type Drag =
    | { mode: 'pan'; startX: number; startY: number; panX0: number; panY0: number }
    | { mode: 'node'; node: GraphNode; offX: number; offY: number }
    | { mode: 'wire'; fromId: string; ox: number; oy: number; cx: number; cy: number };

  let drag = $state<Drag | null>(null);
  let panning = $derived(drag?.mode === 'pan');
  /** Id of the node being dragged — it raises above the others. */
  let draggingId = $derived(drag?.mode === 'node' ? drag.node.id : null);
  /** Currently selected wire (click to select; Delete/Backspace removes it). */
  let selectedWireId = $state<string | null>(null);

  // ---- canvas (background) pan ----------------------------------------------

  /** True when a pointerdown target is the empty canvas plane — NOT a node,
      port, or control. Only then do we pan. */
  function isBackground(t: EventTarget | null): boolean {
    if (!(t instanceof Element)) return false;
    if (t.closest('.node, .port, .palette, .zoomctl, .wire-click')) return false;
    return !!t.closest('.tc, .world');
  }

  function onCanvasPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !isBackground(e.target)) return;
    selectedWireId = null; // clicking empty canvas deselects any wire
    drag = { mode: 'pan', startX: e.clientX, startY: e.clientY, panX0: panX, panY0: panY };
    viewport?.setPointerCapture(e.pointerId);
  }

  // ---- node drag -------------------------------------------------------------

  function onNodePointerDown(e: PointerEvent, node: GraphNode): void {
    // ignore drags that start on a control or a port — those have their own jobs
    if (e.button !== 0) return;
    selectedWireId = null; // interacting with a node deselects any wire
    const t = e.target;
    if (t instanceof Element && t.closest('button, select, input, label, .port, [role="slider"], [role="combobox"]')) return;
    onSelect?.(node); // load into the shell Inspector (no-op standalone)
    const w = toWorld(e.clientX, e.clientY);
    drag = { mode: 'node', node, offX: w.x - node.x, offY: w.y - node.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  // ---- wiring ----------------------------------------------------------------

  function onOutPointerDown(e: PointerEvent, node: GraphNode): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ox = node.x + NODE_W;
    const oy = node.y + PORT_Y;
    const w = toWorld(e.clientX, e.clientY);
    drag = { mode: 'wire', fromId: node.id, ox, oy, cx: w.x, cy: w.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  /** During a wire drag, the node currently under the cursor (a valid drop). */
  let wireTargetId = $state<string | null>(null);

  /** The node id under a screen point — the WHOLE node is the wire drop target.
      Pointer capture sends move/up to the source port, so the destination can't
      report itself; we hit-test geometrically instead. */
  function nodeUnder(clientX: number, clientY: number): string | null {
    const el = document.elementFromPoint(clientX, clientY);
    const nodeEl = el instanceof Element ? el.closest('.node[data-node-id]') : null;
    return nodeEl?.getAttribute('data-node-id') ?? null;
  }

  // ---- shared pointer move / up (canvas-level) ------------------------------

  function onPointerMove(e: PointerEvent): void {
    const d = drag;
    if (!d) return;
    if (d.mode === 'pan') {
      panX = d.panX0 + (e.clientX - d.startX);
      panY = d.panY0 + (e.clientY - d.startY);
    } else if (d.mode === 'node') {
      const w = toWorld(e.clientX, e.clientY);
      store.moveNode(d.node, w.x - d.offX, w.y - d.offY);
    } else {
      // wire: if hovering a valid target node, highlight it + snap the wire to
      // its input port; otherwise the wire end follows the cursor.
      const tid = nodeUnder(e.clientX, e.clientY);
      const target = tid ? nodeById(tid) : undefined;
      const valid = !!target && target.id !== d.fromId && nodeHasInput(target.kind);
      wireTargetId = valid ? target!.id : null;
      if (valid) {
        const p = inPt(target!);
        drag = { ...d, cx: p.x, cy: p.y };
      } else {
        const w = toWorld(e.clientX, e.clientY);
        drag = { ...d, cx: w.x, cy: w.y };
      }
    }
  }
  function onPointerUp(): void {
    if (drag?.mode === 'wire' && wireTargetId) store.connect(drag.fromId, wireTargetId);
    wireTargetId = null;
    drag = null;
  }

  // ---- add-node palette ------------------------------------------------------

  function addAt(kind: BlockKind): void {
    const rect = viewport?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    const wx = (cx - panX) / zoom - NODE_W / 2;
    const wy = (cy - panY) / zoom - 40;
    store.addNode(kind, wx, wy);
  }

  // ---- edge geometry ---------------------------------------------------------

  const nodeById = (id: string): GraphNode | undefined => store.selectedGraph?.nodes.find((n) => n.id === id);

  function outPt(n: GraphNode): { x: number; y: number } {
    return { x: n.x + NODE_W, y: n.y + PORT_Y };
  }
  function inPt(n: GraphNode): { x: number; y: number } {
    return { x: n.x, y: n.y + PORT_Y };
  }

  interface WireGeom {
    id: string;
    d: string;
  }
  const wires = $derived.by<WireGeom[]>(() => {
    const g = store.selectedGraph;
    if (!g) return [];
    const out: WireGeom[] = [];
    for (const e of g.edges) {
      const from = nodeById(e.from);
      const to = nodeById(e.to);
      if (!from || !to) continue;
      const a = outPt(from);
      const b = inPt(to);
      out.push({ id: e.id, d: bezier(a.x, a.y, b.x, b.y) });
    }
    return out;
  });

  const pendingPath = $derived.by<string | null>(() => {
    const d = drag;
    if (d?.mode !== 'wire') return null;
    return bezier(d.ox, d.oy, d.cx, d.cy);
  });

  function bezier(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  // bounds for the SVG edge layer (padded so curves never clip).
  const bounds = $derived.by(() => {
    const g = store.selectedGraph;
    const ns = g?.nodes ?? [];
    if (ns.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of ns) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + 200);
    }
    const M = 200;
    return { x: minX - M, y: minY - M, w: maxX - minX + M * 2, h: maxY - minY + M * 2 };
  });

  function selectEdge(e: WireGeom): void {
    selectedWireId = e.id;
  }
  function onEdgeKey(ev: KeyboardEvent, e: WireGeom): void {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      selectedWireId = e.id;
    } else if (ev.key === 'Backspace' || ev.key === 'Delete') {
      ev.preventDefault();
      if (selectedWireId === e.id) selectedWireId = null;
      store.disconnect(e.id);
    }
  }
</script>

<div
  class="tc"
  class:panning
  {@attach bindViewport}
  role="application"
  aria-label="Trigger node graph — scroll to zoom, drag the empty canvas to pan, drag nodes to rearrange, drag a port to wire"
  onwheel={onWheel}
  onpointerdown={onCanvasPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  {#if store.selectedGraph}
    {#key store.selectedPadKey}
      {@const graph = store.selectedGraph}
      <div class="world" style="transform: translate({panX}px, {panY}px) scale({zoom});">
        <!-- edge layer: existing wires (deletable) + the in-progress wire -->
        <svg
          class="edges"
          style="left: {bounds.x}px; top: {bounds.y}px; width: {bounds.w}px; height: {bounds.h}px;"
          viewBox="{bounds.x} {bounds.y} {bounds.w} {bounds.h}"
        >
          {#each wires as w (w.id)}
            <!-- fat transparent hit-path FIRST so its hover/focus can brighten
                 the visible wire that follows it (adjacent-sibling combinator) -->
            <path
              class="wire-click"
              d={w.d}
              role="button"
              tabindex="0"
              aria-label="Connection — click to select, Delete to remove"
              onclick={() => selectEdge(w)}
              onkeydown={(ev) => onEdgeKey(ev, w)}
            ></path>
            <path class="wire" class:selected={selectedWireId === w.id} d={w.d} />
          {/each}
          {#if pendingPath}
            <path class="wire-pending" d={pendingPath} />
          {/if}
        </svg>

        <!-- nodes -->
        {#each graph.nodes as node (node.id)}
          <div
            class="node"
            class:trigger={node.kind === 'trigger'}
            class:dragging={draggingId === node.id}
            class:selected={selectedId === node.id}
            class:drop-target={wireTargetId === node.id}
            data-node-id={node.id}
            style="left: {node.x}px; top: {node.y}px; width: {NODE_W}px; --tint: {tint[node.kind]};"
            role="group"
            aria-label="{eyebrow[node.kind]} node"
            onpointerdown={(e) => onNodePointerDown(e, node)}
          >
            {#if nodeHasInput(node.kind)}
              <button
                type="button"
                class="port in"
                aria-label="Input — drop a wire here"
                style="top: {PORT_Y}px;"
              ></button>
            {/if}
            {#if nodeHasOutput(node.kind)}
              <button
                type="button"
                class="port out"
                class:wiring={drag?.mode === 'wire' && drag.fromId === node.id}
                aria-label="Output — drag to wire"
                style="top: {PORT_Y}px;"
                onpointerdown={(e) => onOutPointerDown(e, node)}
              ></button>
            {/if}

            {#if node.kind === 'trigger'}
              <div class="eyebrow"><Zap size={12} aria-hidden="true" /> Trigger</div>
              <div class="trigger-pad">
                <span class="pad-drum">{store.selectedPad?.drumLabel ?? ''}</span>
                <span class="pad-sep">·</span>
                <span class="pad-zone">{store.selectedPad?.zoneLabel ?? ''}</span>
              </div>
            {:else}
              <header class="head">
                <span class="sel-wrap">
                  <Select
                    value={node.kind}
                    options={KINDS}
                    onChange={(v) => store.changeKind(node, v as NodeKind)}
                    ariaLabel="Node type"
                    class="sel-kind"
                  />
                </span>
                <IconButton icon={X} label="Remove node" onclick={() => store.removeNode(node)} size={13} />
              </header>

              <div class="body">
                {#if node.kind === 'play'}
                  {@const eff = store.effectOf(node)}
                  <div class="play-row">
                    <button class="thumbbtn" onclick={() => store.openSettings(node)} title="Effect settings" aria-label="Effect settings">
                      {#if eff}<EffectThumb pattern={eff.pattern} params={store.liveParams(node)} w={56} h={32} />{/if}
                    </button>
                    <button class="namebtn" onclick={() => store.openSettings(node)} title="Effect settings">
                      <span class="nm">{eff?.name ?? 'effect'}</span>
                      <span class="pst">{store.presetById(node.presetId)?.name ?? ''}</span>
                    </button>
                    <IconButton icon={Replace} label="Change effect" onclick={() => store.openGallery(node)} variant="soft" size={14} />
                  </div>
                  <div class="node-segs">
                    <SegmentedControl
                      value={node.mode}
                      options={MODE_OPTS}
                      onChange={(v) => store.setMode(node, v as PlayMode)}
                      ariaLabel="Play mode"
                    />
                    <SegmentedControl
                      value={store.busOf(node)}
                      options={LAYER_OPTS}
                      onChange={(v) => store.setBus(node, v)}
                      ariaLabel="Layer"
                    />
                  </div>
                {:else if node.kind === 'random'}
                  <label class="opt">
                    <input type="checkbox" checked={node.noRepeat} onchange={(e) => store.setNoRepeat(node, e.currentTarget.checked)} />
                    no-repeat
                  </label>
                {:else if node.kind === 'switch'}
                  <label class="opt">
                    on
                    <span class="sel-wrap">
                      <Select
                        value={node.on}
                        options={SWITCH_OPTS}
                        onChange={(v) => store.setSwitchOn(node, v as SwitchOn)}
                        ariaLabel="Switch on"
                        class="sel-on"
                      />
                    </span>
                  </label>
                {:else if node.kind === 'chance'}
                  <label class="opt range">
                    <span class="pct-val">{Math.round(node.p * 100)}%</span>
                    <span class="rngwrap">
                      <Slider
                        min={0}
                        max={1}
                        step={0.05}
                        value={node.p}
                        onChange={(v) => store.setChance(node, v)}
                        showValue={false}
                        ariaLabel="Chance"
                      />
                    </span>
                  </label>
                {:else}
                  <span class="eyebrow">{eyebrow[node.kind]}</span>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/key}
  {:else}
    <p class="hint">Select a pad to edit its trigger graph.</p>
  {/if}

  <!-- add-node palette -->
  <div class="palette" role="toolbar" aria-label="Add node">
    <span class="palette-label">Add</span>
    {#each PALETTE as item (item.kind)}
      {@const I = kindIcon[item.kind]}
      <button class="palette-btn" onclick={() => addAt(item.kind)} title="Add {item.label} node" style="--tint: {tint[item.kind]};">
        <I size={14} aria-hidden="true" class="palette-ico" />
        {item.label}
      </button>
    {/each}
  </div>

  <!-- zoom controls -->
  <div class="zoomctl">
    <button onclick={() => zoomBy(1.15)} aria-label="Zoom in"><Plus size={15} aria-hidden="true" /></button>
    <button onclick={() => zoomBy(1 / 1.15)} aria-label="Zoom out"><Minus size={15} aria-hidden="true" /></button>
    <button onclick={reset} aria-label="Reset view" title="Reset view"><Maximize2 size={14} aria-hidden="true" /></button>
    <span class="pct">{Math.round(zoom * 100)}%</span>
  </div>
</div>

<style>
  .tc {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background-color: var(--bg-perform);
    background-image: radial-gradient(circle, var(--border-faint) 1px, transparent 1.4px);
    background-size: 22px 22px;
    cursor: grab;
    touch-action: none;
  }
  .tc.panning {
    cursor: grabbing;
  }
  .world {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    will-change: transform;
  }
  .hint {
    position: absolute;
    inset: 0;
    margin: 0;
    display: grid;
    place-items: center;
    color: var(--text-faint);
    font-size: var(--text-sm);
  }

  /* edge layer ------------------------------------------------------------- */
  .edges {
    position: absolute;
    overflow: visible;
    pointer-events: none;
  }
  .wire {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 1.6;
    pointer-events: none;
    transition: stroke 100ms ease;
  }
  /* a selected wire is simply the green stroke — no halo/glow */
  .wire.selected {
    stroke: var(--accent);
    stroke-width: 2;
  }
  /* a fat, transparent, individually hittable hit-path for deletion. It sits
     BEFORE its visible .wire sibling so its hover/focus can brighten it. */
  .wire-click {
    fill: none;
    stroke: transparent;
    stroke-width: 16;
    pointer-events: stroke;
    cursor: pointer;
  }
  /* keyboard/click focus must not paint the global box-shadow ring around the
     path's bounding box — the wire itself is the highlight. */
  .wire-click:focus,
  .wire-click:focus-visible {
    outline: none;
    box-shadow: none;
  }
  .wire-click:hover,
  .wire-click:focus-visible {
    stroke: color-mix(in oklch, var(--accent) 22%, transparent);
  }
  .wire-click:hover + .wire,
  .wire-click:focus-visible + .wire {
    stroke: var(--accent);
  }
  .wire-pending {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 5 4;
    pointer-events: none;
  }

  /* nodes ------------------------------------------------------------------ */
  .node {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    /* grey body; the type colour lives in the border + dropdown icon */
    background: var(--surface-2);
    border: 1px solid var(--tint);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-1);
    cursor: grab;
    touch-action: none;
    z-index: 1;
  }
  .node:active {
    cursor: grabbing;
  }
  .node.dragging {
    z-index: 50;
    cursor: grabbing;
    box-shadow: var(--shadow-3);
  }
  /* selected into the shell Inspector — accent ring without moving the node */
  .node.selected {
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--accent) 60%, transparent), var(--shadow-1);
  }
  /* whole-node highlight while a wire hovers it as a drop target */
  .node.drop-target {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--accent) 55%, transparent), var(--shadow-1);
  }
  .node.trigger {
    justify-content: center;
    gap: var(--space-1);
  }
  .trigger-pad {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    padding-left: var(--space-1);
  }
  .pad-drum {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ink);
  }
  .pad-sep {
    color: var(--text-faint);
  }
  .pad-zone {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding-left: var(--space-1);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .sel-wrap {
    display: inline-flex;
    flex: 1;
    min-width: 0;
  }
  /* Select renders its trigger on the child root (no scope attr) → reach it
     via :global anchored under our scoped wrapper. */
  .head .sel-wrap :global(.sel-kind) {
    flex: 1;
    min-width: 0;
  }
  .head .sel-wrap :global(.sel-trigger) {
    font-weight: 700;
    font-size: var(--text-sm);
    color: var(--ink);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .node-segs {
    display: flex;
    flex-wrap: nowrap;
    gap: var(--space-2);
  }
  /* keep the play-mode + layer toggles side by side on one row, splitting the
     node width evenly so both fit without wrapping */
  .node-segs :global(.seg) {
    flex: 1;
    min-width: 0;
  }
  .node-segs :global(.seg-row) {
    display: flex;
    width: 100%;
  }
  .node-segs :global(.seg-btn.icononly) {
    flex: 1;
    min-width: 0;
    padding: var(--space-1);
  }
  /* the selected play-mode / layer segment gets an accent stroke */
  .node-segs :global(.seg-btn[data-state='on']) {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .play-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .thumbbtn {
    padding: 2px;
    line-height: 0;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    flex: none;
  }
  .thumbbtn:hover {
    border-color: var(--accent);
  }
  .namebtn {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    padding: var(--space-1) var(--space-1);
    background: transparent;
    border: none;
    text-align: left;
  }
  .namebtn:hover .nm {
    color: var(--accent);
  }
  .nm {
    font-size: var(--text-sm);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .pst {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .opt {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .opt.range {
    gap: var(--space-2);
  }
  .opt .sel-wrap {
    flex: 1;
  }
  .pct-val {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    min-width: 34px;
    font-variant-numeric: tabular-nums;
  }
  .rngwrap {
    display: flex;
    flex: 1;
    min-width: 0;
  }

  /* ports ------------------------------------------------------------------ */
  .port {
    position: absolute;
    width: 9px;
    height: 9px;
    padding: 0;
    border-radius: 999px;
    background: var(--border-strong);
    border: 1.5px solid var(--surface-2);
    cursor: crosshair;
    transition:
      background-color 120ms ease,
      scale 120ms ease;
  }
  /* enlarged transparent hit target so ports are easy to grab */
  .port::after {
    content: '';
    position: absolute;
    inset: -8px;
    border-radius: 999px;
  }
  .port:hover {
    background: var(--accent);
    scale: 1.25;
  }
  .port.in {
    left: 0;
    translate: -50% -50%;
  }
  .port.out {
    right: 0;
    left: auto;
    translate: 50% -50%;
  }
  .port.out.wiring {
    background: var(--accent);
    scale: 1.25;
  }

  /* add-node palette ------------------------------------------------------- */
  .palette {
    position: absolute;
    left: var(--space-2);
    top: var(--space-2);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
    max-width: calc(100% - var(--space-4));
    padding: var(--space-1);
    background: color-mix(in oklch, var(--surface) 86%, transparent);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    backdrop-filter: blur(4px);
  }
  .palette-label {
    padding: 0 var(--space-1);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .palette-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 3px var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    cursor: pointer;
    transition:
      border-color 120ms ease,
      color 120ms ease;
  }
  .palette-btn:hover {
    border-color: var(--border-strong);
    color: var(--ink);
  }
  .palette-btn :global(.palette-ico) {
    color: var(--tint);
    flex: none;
  }

  /* zoom controls ---------------------------------------------------------- */
  .zoomctl {
    position: absolute;
    left: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    background: color-mix(in oklch, var(--surface) 86%, transparent);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    backdrop-filter: blur(4px);
  }
  .zoomctl button {
    min-width: 28px;
    justify-content: center;
    padding: 4px var(--space-2);
  }
  .pct {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-muted);
    min-width: 38px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
