/* Shell navigation VOCABULARY — the view/selection types the shell speaks, plus the one
   genuinely shared function: the URL deep-link parser.

   This used to be a pure reducer with a `ShellNav` state object and five transitions
   (`initialNav`/`setView`/`select`/`clearSelection`/`isSelected`) that `shell-store.svelte.ts`
   wrapped one-for-one. That indirection bought nothing — the reducer had exactly one caller and
   the "so the invariants are unit-testable in node" rationale had expired: rune classes construct
   fine in this repo's node test env, which store.*.test.ts demonstrates at length. INIT-02 S17
   inlined the transitions into ShellStore, where the state they transition actually lives.

   What stays here is what is genuinely shared or genuinely pure: the types (imported by the
   store, LeftRail and the inspectors), `VIEWS` (the rail order AND the parser's whitelist), and
   `parseSearch` — a real URL parser with edge cases and App.svelte's only direct import from this
   module, which is why it remains a separate pure function rather than a ShellStore method.

   The app is mode-less: there is no Perform/Author mode — it is simply whichever `view` is
   selected (Perform being one of them). The invariant that switching views clears the selection
   now lives in ShellStore.setView, next to the fields it clears. */

export type View = 'perform' | 'objects' | 'sections' | 'trigger' | 'patch' | 'monitor';

/** A node id in the Patch Graph (device routing). These are stage-prefixed strings
    minted and decoded by `patch-node-id.ts` (the single grammar owner) — `input` ·
    `trigger:<drumId>` · `drum:<drumId>` · `hoop:<drumId>:<n>` · `output:<OutputConfig.id>`
    · `kit` · `triggers` · `controller` — so the graph can name any node without a
    closed enum. */
export type PatchNodeId = string;

/** What is loaded into an inspector surface: a node in the active trigger graph,
    a Patch-graph device node, a layer/bus, or a setlist section (rename +
    read-only transport-recall info). `null` = nothing selected. */
export type Selection =
  | { kind: 'node'; nodeId: string }
  | { kind: 'patch'; nodeId: PatchNodeId }
  | { kind: 'bus'; busId: string }
  | { kind: 'section'; sectionId: string };

export const VIEWS: readonly View[] = ['perform', 'objects', 'sections', 'trigger', 'patch', 'monitor'];

/** Parse the view deep-link from a query string (?view=). Unknown values are dropped. */
export function parseSearch(search: string): { view?: View } {
  const p = new URLSearchParams(search);
  const out: { view?: View } = {};
  const v = p.get('view');
  if (v && (VIEWS as readonly string[]).includes(v)) out.view = v as View;
  return out;
}
