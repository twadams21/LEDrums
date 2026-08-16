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
import type { SettingsPane, ShellStore, View } from './shell-store.svelte';
import { SETTINGS_PANES } from './shell-nav';
import { makeNode, type GraphNode, type NodeKind, type PlayMode, type TriggerGraph } from '../trigger-lab/sim';
import type { BackupSnapshotMeta, ControllerStatus } from '../ws/protocol-types';
import { voice } from '@ledrums/core';
import { sectionsDndPreview } from './views/sections-dnd-preview.svelte';
import { spliceArmedPreview, wireInvalidPreview } from './views/wire-preview.svelte';
import { lintPreview } from './views/lint-preview.svelte';
import { canvasDropPreview } from './views/canvas-drop-preview.svelte';
import { pushToast, toastStore, type ToastTone } from '../ui/toast.svelte';

/** Let Svelte's reactivity + xyflow flush before the next op reads the DOM. Two
    animation frames is enough for a rune update to render and the flow canvas to
    reconcile; ui-shot adds its own settle before capturing. */
function settle(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Split on the FIRST separator only, so a value may contain it. */
function splitOnce(text: string, sep: string): [string, string | undefined] {
  const i = text.indexOf(sep);
  return i < 0 ? [text, undefined] : [text.slice(0, i), text.slice(i + sep.length)];
}

export interface ShotSeam {
  /** Close every summoned drawer/modal and drop the inspector selection. */
  reset(): void;
  /** Switch the workspace view (perform · objects · sections · trigger · monitor). */
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
  /** Author a one-effect graph, set the named params on it, place it in the active section
      and FIRE it — so a capture can show what an effect actually renders, at whatever moment
      `--settle` lands on. The route to "does this effect's Life param do anything" and to any
      other look-of-the-render shot; without it, proving engine behaviour needs a click chain
      through the gallery and a slider. */
  fireEffect(generatorId: string, params: Record<string, number>): void;
  /** Fire the graph {@link fireEffect} last authored, again. Connected, the show reaches the
      server asynchronously, so the fire that rides the same tick as the authoring can land
      before the engine has the graph — sequence `fire:…,refire` to fire once the sync has
      had a beat. */
  refire(): void;
  /** Hold the op sequence for `ms` — for state that lands asynchronously (the debounced show
      sync to the engine), which no amount of rAF settling will cover. */
  wait(ms: number): Promise<void>;
  /** Select a node — by the kind most recently added, by node id, else the first
      non-trigger node. Flips the Node Editor to its Inspector tab. */
  selectNode(kindOrId: string): void;
  /** Open the effect gallery for the selected / last-added / first effect node. */
  openGallery(): void;
  /** Set that same node's effect (`effect:gen:segments`) through the store seam a gallery
      card click drives — so any registered effect's params/thumbnail are capturable without
      choreographing a scroll-and-click through a 50-card grid. */
  pickEffect(effectId: string): void;
  /** Set that same node's play mode (`mode:loop`). A `oneshot` fire is gone within a frame or
      two, so a sustained state — a held loop, and anything keyed off it — is only capturable
      with the node switched first. */
  setPlayMode(mode: PlayMode): void;
  /** Fire a pad hit through the store's real hit path (`fire` = the selected pad,
      `fire:kick` = that drum's first pad), so a mid-fire frame is capturable. */
  firePad(drumId?: string): void;
  /** Open the Settings modal, optionally on a named section (`settings:outputs`). */
  openSettings(pane?: SettingsPane): void;
  /** Seed a representative set of local backups (#123) and open the Backups dialog, so ui-shot can
      capture the snapshot list + reasons + relative times without a live backend history. */
  previewBackups(): void;
  /** Summon the on-canvas Add-node popover at the canvas centre, via its own `+` control —
      the popover's open state is TriggerGraphView-local, so this drives the real affordance
      rather than duplicating the placement math. Opens the Trigger view first. */
  openAddPopover(): void;
  /** Type a query into the Add palette's search field (drives the flat grouped
      results state). The field's value is component-local, so this drives the
      real input rather than a store method. */
  setSearch(query: string): void;
  /** Type a query into the effect inspector's param filter (S4). Like `setSearch`, the
      field's value is component-local, so this drives the real input. */
  filterParams(query: string): void;
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
  /** Inject a synthetic controller status and open Settings → Controller, so ui-shot can capture
      the controller surface (incl. the R29 admin-password field + the subnet-recommendation card)
      without a live PixLite on the network. `auth` = adopted + authenticated (calm); `needs`
      = adopted but lost/needs-password (warn → shows the subnet guidance under the lost alert);
      `discover` = nothing adopted (the Discover affordance + recommendation card + Adopt-by-IP).
      The Controller pane is an S2 stub until S4d re-homes the panels; the status injection is
      already the shape that pane will render. */
  mockController(kind?: 'auth' | 'needs' | 'discover'): void;
  /** Author a Mix with two wired layer branches and select it, so the Mix inspector shows
      its layer rows + the y-order stacking copy (R13). Reaches a state `add`/`select` can't:
      an empty Mix hides the rows. */
  mixWithLayers(): void;
  /** Author a node whose FACE carries exposed param rows (S5) — the state neither `add` nor
      `select` reaches, since a fresh node's face is bare.

      `face-params` puts the first two number params of a fresh Effect on its face.
      `face-params:wired` additionally wires an LFO into the first row, so the driven state
      (modulation badge + live tick beside an editable base value) is capturable.
      `face-params:mixed` uses a MODIFIER node instead — `trail` declares a number AND an
      enum, so one capture shows both control types on one card. */
  faceParams(mode?: 'wired' | 'mixed'): void;
  /** Author a REAL empty-scope graph so ui-shot can capture the R06 lint surface end to end:
      an Effect scoped to one drum wired to an Output scoped to a different drum → the effective
      scope is empty. Lights the node-face lint badge, the lint strip row, AND (Output selected)
      the inspector's empty-scope row in one capture. Uses genuine `compileRenderPlan` output. */
  emptyScope(): void;
  /** Author a REAL no-path-to-Output graph so ui-shot can capture the R07 reachability lint:
      an Effect whose flow wire to Output is severed → the effect can never reach the terminal
      anchor. Lights the node-face no-path-to-output badge + the lint strip row (Effect selected).
      Uses genuine `compileRenderPlan` output. */
  notReachingOutput(): void;
  /** Push transient toast(s) so ui-shot can capture the top-centre ToastHost stack and its
      per-role tint. `arg` is a single tone (`info`/`success`/`error`); omitted → one of each. */
  previewToasts(tone?: ToastTone): void;
  /** Open Settings with the global control bindings in a representative BOUND state — one
      control bound to a note that collides with a mapped drum zone (so the override warning
      renders), one bound to an OSC address, one left unbound. The live states otherwise need
      real hardware to bind against. */
  previewGlobalControls(): void;
  /** Open Settings with a global control's MIDI (default) or OSC Learn armed, so the
      listening state is capturable without an input device to arm it against. */
  previewGlobalControlLearn(which?: 'midi' | 'osc'): void;
  /** Apply a comma-separated state spec (`view:trigger,add:scope,select:scope`),
      awaiting a render between ops. This is the interface `ui-shot --state` drives. */
  apply(spec: string): Promise<void>;
}

class ShotSeamImpl implements ShotSeam {
  /** Nodes this seam added this session, keyed by kind — so `select:scope` can pick
      the scope node `add:scope` just created without threading its id through the CLI. */
  private added = new Map<NodeKind, GraphNode>();
  private lastAdded: GraphNode | null = null;
  /** The graph {@link fireEffect} authored, so {@link refire} can fire it again. */
  private firedGraphKey: string | null = null;

  constructor(
    private readonly store: TriggerLab,
    private readonly shell: ShellStore,
  ) {}

  reset(): void {
    this.store.closeGallery();
    this.store.closeSettings();
    this.shell.closeSettings();
    this.shell.clearSelection();
    sectionsDndPreview.clear();
    wireInvalidPreview.clear();
    spliceArmedPreview.clear();
    lintPreview.clear();
    canvasDropPreview.clear();
    toastStore.clear();
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

  fireEffect(generatorId: string, params: Record<string, number>): void {
    if (this.store.canTakeover) this.store.takeover();
    const section = this.store.activeSection;
    if (!section) return;
    const key = this.store.createGraph(`Shot ${generatorId}`);
    const created = this.store.addNode('effect', 360, 200);
    if (!created) return;
    // `addNode` hands back a raw node, not the store's live one (same gotcha `selectNode`
    // documents) — and pickEffect/setParam MUTATE what they are given, so every call has to
    // re-resolve through the graph or the edit lands on a detached object.
    const live = (): GraphNode | null => this.store.selectedGraph?.nodes.find((n) => n.id === created.id) ?? null;
    const target = live();
    if (target) this.store.pickEffect(target, `gen:${generatorId}`);
    for (const [paramKey, value] of Object.entries(params)) {
      const node = live();
      if (node) this.store.setParam(node, paramKey, value);
    }
    // Without this the graph resolves nothing on a fire: a fresh effect node auto-wires to
    // Output, but nothing drives it.
    const trigger = this.store.selectedGraph?.nodes.find((n) => n.kind === 'trigger');
    if (trigger) this.store.connect(trigger.id, created.id);
    this.store.addGraphToSection(section.id, key);
    this.firedGraphKey = key;
    this.refire();
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  refire(): void {
    const index = this.firedGraphKey ? (this.store.activeSection?.graphs.indexOf(this.firedGraphKey) ?? -1) : -1;
    if (index >= 0) this.store.fireSectionGraph(index);
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

  /** Bind the last-added (else first) sequence node's reset source to a representative value of
      `kind`, so the bound inspector states screenshot without click choreography. The node is
      re-resolved THROUGH the store's graph (not the `added` reference): `addNode` returns the raw
      object, and mutating it directly would bypass the $state proxy — the write would land but
      never re-render. */
  private bindSequenceReset(kind: 'drum' | 'midi' | 'osc'): void {
    const graph = this.store.selectedGraph;
    const addedId = this.added.get('sequence')?.id;
    const seq =
      (addedId ? graph?.nodes.find((n) => n.id === addedId) : undefined) ??
      graph?.nodes.find((n) => n.kind === 'sequence');
    if (!seq) return;
    const source =
      kind === 'drum'
        ? ({ kind: 'drum', drumId: this.store.drums[0]?.id ?? 'kick', zone: '0' } as const)
        : kind === 'osc'
          ? ({ kind: 'osc', address: '/reset' } as const)
          : ({ kind: 'midi', note: 61 } as const);
    this.store.setSequenceResetSource(seq, source);
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

  pickEffect(effectId: string): void {
    const target = this.effectTarget();
    if (target) this.store.pickEffect(target, effectId);
  }

  setPlayMode(mode: PlayMode): void {
    const target = this.effectTarget();
    if (target) this.store.setMode(target, mode);
  }

  firePad(drumId?: string): void {
    const pads = this.store.pads;
    const wanted = drumId?.toLowerCase();
    const match = wanted
      ? pads.find((p) => p.drumId.toLowerCase() === wanted || p.drumLabel.toLowerCase().startsWith(wanted))
      : undefined;
    const pad = match ?? pads[0];
    if (pad) this.store.hit(pad);
  }

  /** The effect/play node an effect op acts on: the selected one, else the last added, else the
      graph's first. Always re-resolved THROUGH `graph.nodes` — `addNode` hands back the raw
      object, and passing that to a mutator bypasses the `$state` proxy (the write lands but
      never re-renders). */
  private effectTarget(): GraphNode | null {
    const graph = this.store.selectedGraph;
    if (!graph) return null;
    const isEffect = (node: GraphNode): boolean => node.kind === 'effect' || node.kind === 'play';
    const byId = (id: string | null | undefined): GraphNode | undefined =>
      id ? graph.nodes.find((node) => node.id === id) : undefined;
    const selectedId = this.shell.selection?.kind === 'node' ? this.shell.selection.nodeId : null;
    const candidates = [byId(selectedId), byId(this.lastAdded?.id), graph.nodes.find(isEffect)];
    return candidates.find((node): node is GraphNode => !!node && isEffect(node)) ?? null;
  }

  openSettings(pane?: SettingsPane): void {
    // Settings routing lives in the shell store (deep-linkable `?settings=<pane>`),
    // so the seam drives the same method the gear + the URL drive.
    this.shell.openSettings(pane);
  }

  previewBackups(): void {
    // Seed a representative snapshot set (one of each reason, spread across time) so the capture
    // reads like a real recovery list, then open the dialog via its stable TopBar control. The
    // dialog's own refreshBackups() would overwrite this from a live server, but the dev shot
    // session has no backup history — so the seed is what a real machine's list would look like.
    const nowMs = Date.now();
    const seed: BackupSnapshotMeta[] = [
      { id: `${nowMs - 4 * 60_000}-pre-risk`, createdAt: nowMs - 4 * 60_000, reason: 'pre-risk' },
      { id: `${nowMs - 35 * 60_000}-cadence`, createdAt: nowMs - 35 * 60_000, reason: 'cadence' },
      { id: `${nowMs - 3 * 3_600_000}-cadence`, createdAt: nowMs - 3 * 3_600_000, reason: 'cadence' },
      { id: `${nowMs - 27 * 3_600_000}-boot`, createdAt: nowMs - 27 * 3_600_000, reason: 'boot' },
    ];
    this.store.backups = seed;
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Backups"]');
    button?.click();
    // The dialog's open-effect fires refreshBackups(); a live dev server may answer with its own
    // (near-empty) list and clobber the seed. Re-assert across a few frames so the capture shows the
    // representative set. Dev-only.
    let frames = 0;
    const reassert = (): void => {
      this.store.backups = seed;
      if (frames++ < 30) requestAnimationFrame(reassert);
    };
    requestAnimationFrame(reassert);
  }

  openAddPopover(): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.setView('trigger');
    document.querySelector<HTMLButtonElement>('button[aria-label="Add node"]')?.click();
  }

  setSearch(query: string): void {
    // The Add palette's search value is AddPalette-local state (not the store), so
    // drive the real input and fire `input` for Svelte's bind:value to pick up.
    // The effect gallery owns a second field with the same job; when it is open it is the
    // one on screen, so search there rather than at a hidden pane behind the dialog.
    const input =
      document.querySelector<HTMLInputElement>('input[aria-label="Search effects"]') ??
      document.querySelector<HTMLInputElement>('input[aria-label="Search nodes"]');
    if (!input) return;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  filterParams(query: string): void {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter parameters"]');
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

  mockController(kind: 'auth' | 'needs' | 'discover' = 'auth'): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.openSettings('controller');
    // Nothing adopted — the un-adopted branch (Discover + recommendation card + Adopt-by-IP). The
    // recommendation comes from the real NIC list the panel's mount requests, so this captures
    // the true "different IP addresses" guidance, not a stub.
    if (kind === 'discover') {
      this.store.controllerStatus = null;
      let f = 0;
      const hold = (): void => {
        this.store.controllerStatus = null; // resist the dev server's own (null) status echoes
        if (f++ < 30) requestAnimationFrame(hold);
      };
      requestAnimationFrame(hold);
      return;
    }
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
    // The pane's mount sends `watchController`, and a dev server with no adopted controller may
    // answer with a null `controllerStatus` that would wipe the synthetic one. Re-assert across a few
    // frames so the injected status is what the panel renders when ui-shot captures. Dev-only.
    let frames = 0;
    const reassert = (): void => {
      this.store.controllerStatus = status;
      if (frames++ < 30) requestAnimationFrame(reassert);
    };
    requestAnimationFrame(reassert);
  }

  previewGlobalControls(): void {
    this.claimEdit(() => {
      // The override warning still deserves a picture, but the editors can no longer PRODUCE
      // that state — `setGlobalControlBinding` now refuses a note a drum zone already owns
      // (`binding-claims`). The one route left is a pasted patch, which reaches the server as
      // a bulk `setProject` and never passes the guard. So this writes the colliding binding
      // straight onto the project, exactly as an imported patch would deliver it.
      const project = this.store.project;
      const mapped = project?.inputMap.midiNotes[0];
      if (project && mapped) {
        project.inputMap.globalControls = {
          ...project.inputMap.globalControls,
          nextSong: { midiNote: mapped.note },
        };
      } else {
        this.store.setGlobalControlBinding('nextSong', { midiNote: 36 });
      }
      this.store.setGlobalControlBinding('nextSection', { oscAddress: '/ledrums/next_section' });
      this.store.setGlobalControlBinding('prevSection', { midiNote: 101, oscAddress: '/ledrums/prev_section' });
      // One of each remaining kind, so the capture covers the whole catalogue's shapes:
      // a momentary hold, and the continuous CC-bound dimmer.
      this.store.setGlobalControlBinding('panicBlackoutMomentary', { midiNote: 102 });
      this.store.setGlobalControlBinding('masterBrightness', { midiCc: 7, oscAddress: '/ledrums/brightness' });
      // prevSong deliberately left unbound — the empty state belongs in the same frame.
    });
    this.openSettings();
  }

  previewGlobalControlLearn(which: 'midi' | 'osc' = 'midi'): void {
    this.claimEdit(() => {
      this.store.setGlobalControlBinding('nextSong', { midiNote: 100 });
      if (which === 'osc') this.store.startOscLearn({ kind: 'global-control', action: 'nextSection' });
      else this.store.startMidiLearn({ kind: 'global-control', action: 'nextSection' });
    });
    this.openSettings();
  }

  /**
   * Run an authoring mutation once this client actually HOLDS the edit lock.
   *
   * `takeover()` only sends a request — `isViewer` flips when the server grants it, so a
   * mutation called synchronously straight after is silently dropped by the viewer guard
   * and the capture shows stale state. Retry across a few frames until it lands (the same
   * shape `previewBackups` / `mockController` use to outlast a server echo). Dev-only.
   */
  private claimEdit(mutate: () => void): void {
    if (this.store.canTakeover) this.store.takeover();
    if (!this.store.isViewer && this.store.project) {
      mutate();
      return;
    }
    let frames = 0;
    const attempt = (): void => {
      if (!this.store.isViewer && this.store.project) {
        mutate();
        return;
      }
      if (frames++ < 60) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }

  previewToasts(tone?: ToastTone): void {
    // ttl:0 keeps them pinned for the capture (no auto-dismiss race). Oldest-first so the
    // host renders info → success → error top-to-bottom when showing the full set.
    const tones: ToastTone[] = tone ? [tone] : ['info', 'success', 'error'];
    const messages: Record<ToastTone, string> = {
      info: 'Pasted 3 layers.',
      success: 'Section copied.',
      error: 'That clipboard content isn’t from LEDrums.',
    };
    for (const t of tones) pushToast(messages[t], { tone: t, ttl: 0 });
  }

  async apply(spec: string): Promise<void> {
    for (const token of spec.split(',')) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(':');
      const op = (idx >= 0 ? trimmed.slice(0, idx) : trimmed).trim();
      const arg = idx >= 0 ? trimmed.slice(idx + 1).trim() : undefined;
      await this.runOp(op, arg);
      await settle();
    }
  }

  private runOp(op: string, arg?: string): void | Promise<void> {
    switch (op) {
      // wait:<ms> — hold the sequence. The show reaches the server on a 300ms debounce, so a
      // capture that authors a graph and then fires it has to let the sync land in between.
      case 'wait':
        return this.wait(Number(arg) || 0);
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
      // fire:<generatorId>[:key=value[;key=value]] — e.g. `fire:chase-bands:lifeBeats=8`
      case 'fire': {
        if (!arg) break;
        const [generatorId, spec] = splitOnce(arg, ':');
        const params: Record<string, number> = {};
        for (const pair of (spec ?? '').split(';')) {
          const [k, v] = splitOnce(pair.trim(), '=');
          if (k && v !== undefined && Number.isFinite(Number(v))) params[k] = Number(v);
        }
        this.fireEffect(generatorId, params);
        break;
      }
      case 'refire':
        this.refire();
        break;
      case 'gallery':
        this.openGallery();
        break;
      case 'effect':
        if (arg) this.pickEffect(arg);
        break;
      case 'mode':
        if (arg === 'oneshot' || arg === 'loop' || arg === 'hold') this.setPlayMode(arg);
        break;
      case 'fire':
        this.firePad(arg);
        break;
      case 'settings':
        // `settings` opens the modal on its default pane; `settings:outputs` deep-links a section.
        this.openSettings(arg && (SETTINGS_PANES as readonly string[]).includes(arg) ? (arg as SettingsPane) : undefined);
        break;
      case 'backups':
        this.previewBackups();
        break;
      case 'add-popover':
        this.openAddPopover();
        break;
      case 'search':
        this.setSearch(arg ?? '');
        break;
      case 'param-filter':
        this.filterParams(arg ?? '');
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
        this.mockController(arg === 'needs' ? 'needs' : arg === 'discover' ? 'discover' : 'auth');
        break;
      case 'expanded':
        // Flip the Advatek expanded/normal controller mode — the ONLY control over the output-port
        // count (8 expanded / 4 normal). Drives kit.outputs reconcile so the patch graph's output
        // half can be captured at either count. `expanded` / `expanded:on` → on; `expanded:off` → off.
        this.store.setKitGlobal({ expanded: arg !== 'off' });
        break;
      case 'seq-reset':
        // Bind the last-added sequence node's reset source (`seq-reset:drum|midi|osc`) — thin
        // adapter over setSequenceResetSource so the bound inspector states are capturable.
        this.bindSequenceReset(arg === 'drum' ? 'drum' : arg === 'osc' ? 'osc' : 'midi');
        break;
      case 'mix-layers':
        this.mixWithLayers();
        break;
      case 'face-params':
        this.faceParams(arg === 'wired' ? 'wired' : arg === 'mixed' ? 'mixed' : undefined);
        break;
      case 'empty-scope':
        this.emptyScope();
        break;
      case 'no-path-to-output':
        this.notReachingOutput();
        break;
      case 'global-controls':
        this.previewGlobalControls();
        break;
      case 'global-control-learn':
        this.previewGlobalControlLearn(arg === 'osc' ? 'osc' : 'midi');
        break;
      case 'toast':
      case 'toasts':
        this.previewToasts(arg as ToastTone | undefined);
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

  faceParams(mode?: 'wired' | 'mixed'): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.setView('trigger');
    // A modifier node is the mixed-TYPE case (`trail`: a number + an enum); an effect node
    // gives two numbers, the modulatable pair the wired capture needs.
    const target = mode === 'mixed' ? this.addNode('modifier') : this.addNode('effect');
    if (!target) return;
    // The store hands back the RAW node — always re-resolve through the live graph before
    // mutating, or the value lands but never re-renders (ROUTER gotcha).
    const live = () => this.store.selectedGraph?.nodes.find((n) => n.id === target.id) ?? null;
    const node = live();
    if (!node) return;
    for (const spec of this.store.faceParamSpecs(node).slice(0, 2)) {
      const n = live();
      if (n) this.store.addFaceParam(n, spec.key);
    }
    if (mode === 'wired') {
      // Placed explicitly, well clear of the target — the staggered `addNode` default would
      // drop the source card ON TOP of the very rows the capture exists to show.
      const lfo = this.store.addNode('lfo', 60, 420);
      const n = live();
      const key = n ? this.store.modDropTarget(n) : undefined;
      if (lfo && key) this.store.connect(lfo.id, target.id, undefined, `param:${key}`);
    }
    this.lastAdded = target;
    this.shell.select({ kind: 'node', nodeId: target.id });
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

  notReachingOutput(): void {
    if (this.store.canTakeover) this.store.takeover();
    this.shell.setView('trigger');
    const graph = this.store.selectedGraph;
    if (!graph) return;
    // Reuse an existing Effect if one is wired; otherwise a fresh one auto-wires to Output (R04),
    // giving us an Effect → Output edge to sever.
    const fx = graph.nodes.find((n) => n.kind === 'effect' || n.kind === 'play') ?? this.addNode('effect') ?? undefined;
    if (!fx) return;
    // Cut every outgoing flow wire from the Effect: with no path forward it can never reach the
    // terminal Output anchor → the R07 no-path-to-output lint (badge + strip). Re-read the graph so
    // the freshly auto-wired edge is included.
    const live = this.store.selectedGraph;
    if (live) for (const e of live.edges.filter((e) => e.from === fx.id)) this.store.disconnect(e.id);
    // Select the Effect so its inspector + node badge + strip row are captured together.
    this.shell.select({ kind: 'node', nodeId: fx.id });
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
