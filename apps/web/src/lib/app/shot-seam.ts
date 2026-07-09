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
import type { GraphNode, NodeKind } from '../trigger-lab/sim';

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
      default:
        console.warn(`[shot-seam] unknown state op "${op}"`);
    }
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
