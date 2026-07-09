/* Dev-only screenshot control seam (`window.__LEDRUMS_SHOT__`).

   The hard part of a UI screenshot is not cropping the element — it is getting
   the app into the state where the element exists. This module is a thin adapter
   over the existing engine + shell stores that drives that state deterministically,
   so `pnpm ui-shot --state "view:trigger,add:scope,select:scope"` replaces the
   fragile Playwright click choreography that used to live in `shots.json`.

   It duplicates NO logic: every operation calls the same public store methods the
   UI calls. It is installed only under `import.meta.env.DEV` (see App.svelte's
   dynamic import) so it is dead-code-eliminated from production bundles.

   To teach `ui-shot` a new app state, add ONE method here — never a bespoke click
   script in a preset. */

import type { TriggerLab } from '../trigger-lab/store.svelte';
import type { ShellStore, View } from './shell-store.svelte';
import { makeNode, type GraphNode, type NodeKind, type TriggerGraph } from '../trigger-lab/sim';
import type { ControllerStatus } from '../ws/protocol-types';
import { voice } from '@ledrums/core';
import { sectionsDndPreview } from './views/sections-dnd-preview.svelte';
import { spliceArmedPreview, wireInvalidPreview } from './views/wire-preview.svelte';
import { lintPreview } from './views/lint-preview.svelte';
import { canvasDropPreview } from './views/canvas-drop-preview.svelte';

/** Let Svelte's reactivity + xyflow flush before the next op reads the DOM. Two
    animation frames is enough for a rune update to render and the flow canvas to
    reconcile; ui-shot adds its own settle before capturing. */
function settle(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export interface ShotSeam {
  /** Close every summoned drawer/modal and drop the inspector selection. */
  reset(): void;
  /** Switch the workspace view (perform · objects · sections · trigger · patch · monitor). */
  setView(view: View): void;
  /** Open a trigger graph. No arg keeps the pre-selected pad graph; an arg matches a
      graph by key, key prefix (`snare` → `snare:0`), or label substring. */
  openGraph(nameOrKey?: string): void;
  /** Author a fresh empty graph and select it — a clean slate whose only node is the implicit
      trigger. A source node added here gets a collision-free id, so `add:<kind>,select:<kind>`
      reliably reaches that kind's inspector even when the authored pad graphs carry ids that a
      fresh session's id counter would otherwise duplicate. */
  newGraph(): void;
  /** Add a node of `kind` to the open graph and remember it for a later `selectNode`. */
  addNode(kind: NodeKind): GraphNode | null;
  /** Select a node — by the kind most recently added, by node id, else the first
      non-trigger node. Flips the Node Editor to its Inspector tab. */
  selectNode(kindOrId: string): void;
  /** Open the effect gallery for the selected / last-added / first effect node. */
  openGallery(): void;
  /** Open the app Settings dialog (clicks the stable TopBar control). */
  openSettings(): void;
  /** Type a query into the Add pane's search field (drives the flat grouped
      results state). The field's value is component-local, so this drives the
      real input rather than a store method. */
  setSearch(query: string): void;
  /** Pin a Sections drop indicator so ui-shot can capture the otherwise drag-only
      states: `graph` = insertion line at a gap, `section` = reorder target outline. */
  previewSectionsDnd(kind: 'graph' | 'section'): void;
  /** Pin the R03 invalid-wire drag state (red/dotted/dull wire-in-progress) so ui-shot can
      capture it — the live state is drag-only and headless Chrome can't drive the gesture. Opens
      the Trigger graph and ensures it has a target node the static stand-in wire can end on. */
  previewWireInvalid(): void;
  /** Pin the R08 armed-splice indication (the accent/glow a wire wears while a node is dragged
      over it) so ui-shot can capture it — the live state is drag-only. Opens the Trigger graph,
      ensures a flow wire exists (a fresh Effect auto-wires to Output), and arms it. */
  previewSpliceArmed(): void;
  /** Pin the R12 canvas drag-over highlight (the accent ring the graph canvas wears while a new
      node is dragged in from the Add pane) so ui-shot can capture it — the live state is drag-only
      and headless Chrome can't drive the gesture. Opens the Trigger graph so the canvas is live. */
  previewCanvasDrop(): void;
  /** Pin the R05 graph lint strip's issues so ui-shot can capture it — a well-formed authored
      graph is guaranteed anchors and refuses cycles, so the live strip is otherwise empty. Opens
      the Trigger graph and pins REAL `compileRenderPlan` issues (from a degenerate graph) so the
      capture shows genuine compiler output, not a mock. */
  previewLintIssues(): void;
  /** Open the Patch controller inspector on a synthetic ADOPTED controller so ui-shot can
      capture the controller panel (incl. the R29 admin-password field), which otherwise needs
      a live PixLite on the network. `auth` = authenticated (calm); `needs` = requires a password
      it doesn't have yet (warn). Injects a `controllerStatus` the panel reads verbatim. */
  mockController(kind?: 'auth' | 'needs'): void;
  /** Author a Mix with two wired layer branches and select it, so the Mix inspector shows
      its layer rows + the y-order stacking copy (R13). Reaches a state `add`/`select` can't:
      an empty Mix hides the rows. */
  mixWithLayers(): void;
  /** Author a REAL empty-scope graph so ui-shot can capture the R06 lint surface end to end:
      an Effect scoped to one drum wired to an Output scoped to a different drum → the effective
      scope is empty. Lights the node-face lint badge, the lint strip row, AND (Output selected)
      the inspector's empty-scope row in one capture. Uses genuine `compileRenderPlan` output. */
  emptyScope(): void;
  /** Apply a comma-separated state spec (`view:trigger,add:scope,select:scope`),
      awaiting a render between ops. This is the interface `ui-shot --state` drives. */
  apply(spec: string): Promise<void>;
}

class ShotSeamImpl implements ShotSeam {
  /** Nodes this seam added this session, keyed by kind — so `select:scope` can pick
      the scope node `add:scope` just created without threading its id through the CLI. */
  private added = new Map<NodeKind, GraphNode>();
  private lastAdded: GraphNode | null = null;

  constructor(
    private readonly store: TriggerLab,
    private readonly shell: ShellStore,
  ) {}

  reset(): void {
    this.store.closeGallery();
    this.store.closeSettings();
    this.shell.clearSelection();
    sectionsDndPreview.clear();
    wireInvalidPreview.clear();
    spliceArmedPreview.clear();
    lintPreview.clear();
    canvasDropPreview.clear();
    this.added.clear();
    this.lastAdded = null;
  }

  setView(view: View): void {
    this.shell.setView(view);
  }

  openGraph(nameOrKey?: string): void {
    // Ensure we can author (a live viewer session is otherwise a no-op mutator).
    if (this.store.canTakeover) this.store.takeover();
    if (!nameOrKey) return; // a pad graph is pre-selected on boot
    const key = this.resolveGraphKey(nameOrKey);
    if (!key) return;
    const section = this.store.activeSectionId;
    if (section) this.store.selectGraphInSection(section, key);
    else this.store.selectedPadKey = key;
  }

  newGraph(): void {
    if (this.store.canTakeover) this.store.takeover();
    this.store.createGraph();
    this.added.clear();
    this.lastAdded = null;
  }

  addNode(kind: NodeKind): GraphNode | null {
    if (this.store.canTakeover) this.store.takeover();
    // Stagger placements so successive adds don't stack on one another in the canvas.
    const n = this.added.size;
    const node = this.store.addNode(kind, 360 + n * 48, 200 + n * 48);
    if (node) {
      this.added.set(kind, node);
      this.lastAdded = node;
    }
    return node;
  }

  selectNode(kindOrId: string): void {
    const graph = this.store.selectedGraph;
    if (!graph) return;
    const byKind = this.added.get(kindOrId as NodeKind);
    const byId = graph.nodes.find((node) => node.id === kindOrId);
    const byKindLive = byKind && graph.nodes.some((node) => node.id === byKind.id) ? byKind : null;
    const fallback = graph.nodes.find((node) => node.kind !== 'trigger');
    const target = byKindLive ?? byId ?? fallback;
    if (target) this.shell.select({ kind: 'node', nodeId: target.id });
  }

  openGallery(): void {
    const graph = this.store.selectedGraph;
    if (!graph) return;
    const isEffect = (node: GraphNode): boolean => node.kind === 'effect' || node.kind === 'play';
    const selectedId = this.shell.selection?.kind === 'node' ? this.shell.selection.nodeId : null;
    const selected = selectedId ? graph.nodes.find((node) => node.id === selectedId) : null;
    const target =
      (selected && isEffect(selected) && selected) ||
      (this.lastAdded && isEffect(this.lastAdded) && this.lastAdded) ||
      graph.nodes.find(isEffect);
    if (target) this.store.openGallery(target);
  }

  openSettings(): void {
    // App settings live in the TopBar's local state, not the store; click the one
    // stable control rather than duplicate that state. Encapsulated here so presets
    // stay declarative (`state: "settings"`) instead of carrying a click chain.
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    button?.click();
  }

  setSearch(query: string): void {
    // The Add pane's search value is AddPalette-local state (not the store), so
    // drive the real input and fire `input` for Svelte's bind:value to pick up.
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search nodes"]');
    if (!input) return;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  previewSectionsDnd(kind: 'graph' | 'section'): void {
    this.shell.setView('sections');
    const sections = this.store.activeSong?.sections ?? [];
    if (sections.length === 0) return;
    if (kind === 'graph') {
      // Land the line one gap in from the top of the first non-empty section (or gap 0).
      const target = sections.find((s) => s.graphs.length > 0) ?? sections[0]!;
      sectionsDndPreview.set({ kind: 'graph', sectionId: target.id, index: Math.min(1, target.graphs.length) });
    } else {
      // Pin the vertical insert-line in an interior gap (between the first two columns when
      // there are ≥2, else the leading gap) so it reads as a mid-setlist reorder target.
      sectionsDndPreview.set({ kind: 'section', index: sections.length >= 2 ? 1 : 0 });
    }
  }

  previewWireInvalid(): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.setView('trigger');
    // The static stand-in wire spans two nodes — make sure the open graph has a non-trigger node
    // for its far end to land on, so the capture reads as a wire refused AT a target.
    const graph = this.store.selectedGraph;
    if (graph && graph.nodes.every((n) => n.kind === 'trigger')) this.addNode('play');
    wireInvalidPreview.set(true);
  }

  previewSpliceArmed(): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.setView('trigger');
    // The armed indication needs a flow wire to sit on; a fresh Effect auto-wires to Output (R04),
    // so add one if the open graph has no non-trigger nodes yet.
    const graph = this.store.selectedGraph;
    if (graph && graph.nodes.every((n) => n.kind === 'trigger' || n.kind === 'output')) this.addNode('effect');
    spliceArmedPreview.set(true);
  }

  previewCanvasDrop(): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.setView('trigger');
    // The highlight lives on the open Trigger canvas; a pad graph is pre-selected on boot, so no
    // node is required — the ring wraps the whole surface regardless of graph contents.
    canvasDropPreview.set(true);
  }

  previewLintIssues(): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.setView('trigger');
    // Compile a deliberately degenerate graph so the pinned issues are genuine compiler output,
    // not hand-written copy: a trigger with two route nodes wired into a cycle and NO Output
    // anchor → `missing-output` + `flow-cycle`. This exercises both a plain row and the cycle
    // detail line in one capture.
    const degenerate: TriggerGraph = {
      version: 3,
      nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('all', 'a', 200, 0), makeNode('all', 'b', 200, 120)],
      edges: [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'a' },
      ],
    };
    lintPreview.set(voice.compileRenderPlan(degenerate).issues);
  }

  mockController(kind: 'auth' | 'needs' = 'auth'): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.setView('patch');
    const reachable = kind === 'auth';
    // A representative adopted PixLite (authReqd true so the panel's password field is the point of
    // interest). The same shape the server's `controllerStatus` broadcast carries.
    const status: ControllerStatus = {
      host: '192.168.1.50',
      reachable,
      identity: {
        host: '192.168.1.50',
        prodName: 'PixLite A4-S Mk3',
        nickname: 'Kick Left',
        fwVer: '1.4.2',
        authReqd: true,
      },
      universes: reachable
        ? [
            { uniNum: 0, protocol: 'sACN', receiving: true, inGood: 44_318, inBadSeq: 0, priority: 100 },
            { uniNum: 1, protocol: 'sACN', receiving: true, inGood: 44_012, inBadSeq: 0, priority: 100 },
          ]
        : [],
      rates: reachable ? { inFrmRate: 44, outFrmRate: 44 } : {},
      health: reachable ? { tempC: 41, bankVoltsMv: [12_100], ethLinkUp: [true, false] } : {},
      lastSeen: reachable ? Date.now() : Date.now() - 8_000,
      testPattern: null,
    };
    this.store.controllerStatus = status;
    // Open the Patch controller node's inspector (patch selection 'controller' → PatchControllerInspector).
    this.shell.select({ kind: 'patch', nodeId: 'controller' });
    // The inspector's mount sends `watchController`, and a dev server with no adopted controller may
    // answer with a null `controllerStatus` that would wipe the synthetic one. Re-assert across a few
    // frames so the injected status is what the panel renders when ui-shot captures. Dev-only.
    let frames = 0;
    const reassert = (): void => {
      this.store.controllerStatus = status;
      if (frames++ < 30) requestAnimationFrame(reassert);
    };
    requestAnimationFrame(reassert);
  }

  async apply(spec: string): Promise<void> {
    for (const token of spec.split(',')) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(':');
      const op = (idx >= 0 ? trimmed.slice(0, idx) : trimmed).trim();
      const arg = idx >= 0 ? trimmed.slice(idx + 1).trim() : undefined;
      this.runOp(op, arg);
      await settle();
    }
  }

  private runOp(op: string, arg?: string): void {
    switch (op) {
      case 'reset':
        this.reset();
        break;
      case 'view':
        if (arg) this.setView(arg as View);
        break;
      case 'graph':
      case 'open':
        this.openGraph(arg);
        break;
      case 'new-graph':
        this.newGraph();
        break;
      case 'add':
        if (arg) this.addNode(arg as NodeKind);
        break;
      case 'select':
        if (arg) this.selectNode(arg);
        break;
      case 'gallery':
        this.openGallery();
        break;
      case 'settings':
        this.openSettings();
        break;
      case 'search':
        this.setSearch(arg ?? '');
        break;
      case 'sections-insert':
        this.previewSectionsDnd('graph');
        break;
      case 'sections-reorder':
        this.previewSectionsDnd('section');
        break;
      case 'wire-invalid':
        this.previewWireInvalid();
        break;
      case 'splice-armed':
        this.previewSpliceArmed();
        break;
      case 'lint-issues':
        this.previewLintIssues();
        break;
      case 'canvas-drop':
        this.previewCanvasDrop();
        break;
      case 'controller':
        this.mockController(arg === 'needs' ? 'needs' : 'auth');
        break;
      case 'mix-layers':
        this.mixWithLayers();
        break;
      case 'empty-scope':
        this.emptyScope();
        break;
      default:
        console.warn(`[shot-seam] unknown state op "${op}"`);
    }
  }

  mixWithLayers(): void {
    if (this.store.canTakeover) this.store.takeover();
    const mix = this.store.addNode('mix', 620, 200);
    const top = this.store.addNode('effect', 360, 150);
    const bottom = this.store.addNode('effect', 360, 300);
    if (!mix || !top || !bottom) return;
    // The fresh Effects auto-wired straight to Output (R04); this demo routes them through the
    // Mix instead, so drop those direct edges before composing top + bottom → mix.
    const graph = this.store.selectedGraph;
    if (graph) {
      for (const e of graph.edges.filter((e) => (e.from === top.id || e.from === bottom.id) && e.to === 'output')) {
        this.store.disconnect(e.id);
      }
    }
    this.store.connect(top.id, mix.id);
    this.store.connect(bottom.id, mix.id);
    this.added.set('mix', mix);
    this.lastAdded = mix;
    this.shell.select({ kind: 'node', nodeId: mix.id });
  }

  emptyScope(): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.setView('trigger');
    const graph = this.store.selectedGraph;
    if (!graph) return;
    // Reuse an existing Effect if one is already wired; otherwise a fresh one auto-wires to
    // Output (R04), giving the Effect → Output flow path the lint walks.
    const fx = graph.nodes.find((n) => n.kind === 'effect' || n.kind === 'play') ?? this.addNode('effect') ?? undefined;
    const output = graph.nodes.find((n) => n.kind === 'output');
    if (!fx || !output) return;
    // Two distinct drums so the intersection is provably empty for every firing drum. Prefer
    // real kit drums; fall back to canonical ids if the kit isn't populated in this session.
    const drums = this.store.kitDrumInfos;
    const drumA = drums[0]?.id ?? 'kick';
    const drumB = drums.find((d) => d.id !== drumA)?.id ?? 'snare';
    this.store.setScope(fx, 'drum');
    this.store.setTargetId(fx, drumA);
    this.store.setScope(output, 'drum');
    this.store.setTargetId(output, drumB);
    // Select the Output so its inspector (with the empty-scope row) is captured alongside the
    // canvas badge + strip.
    this.shell.select({ kind: 'node', nodeId: output.id });
  }

  private resolveGraphKey(nameOrKey: string): string | null {
    const library = this.store.graphLibrary;
    const needle = nameOrKey.toLowerCase();
    const exact = library.find((g) => g.key === nameOrKey);
    if (exact) return exact.key;
    const prefixed = library.find((g) => g.key.toLowerCase().startsWith(`${needle}:`));
    if (prefixed) return prefixed.key;
    const labelled = library.find((g) => g.label.toLowerCase().includes(needle));
    return labelled?.key ?? null;
  }
}

/** Attach the seam to `window`. Idempotent; dev-only (guard at the call site). */
export function installShotSeam(store: TriggerLab, shell: ShellStore): void {
  (window as unknown as { __LEDRUMS_SHOT__?: ShotSeam }).__LEDRUMS_SHOT__ = new ShotSeamImpl(store, shell);
}
