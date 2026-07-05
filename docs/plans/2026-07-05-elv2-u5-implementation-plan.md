# Effects Library v2 U5 — implementation plan

Issue: #58 — Typed play nodes UI + Canvas authoring UI

Status of this file: implementation handoff only. It is intentionally prescriptive: an implementation agent should be able to follow the file path list, paste/adapt the snippets, add the tests, and avoid rediscovering the U1–U4 context.

Verified against `main` after U1–U4 landed. The earlier state-report warning about Trent WIP files is superseded by the 2026-07-05 chat note: there are no remaining WIP files to avoid.

---

## 0. Non-negotiables

Read first:

- `docs/plans/2026-07-05-effects-library-v2.md`
  - D3: typed play nodes use the same `PlayType` taxonomy as gallery collections.
  - D4: canvas scenes are authored data, resolved as `canvas:<sceneId>` through the existing `EffectGenerator` seam.
  - Decisions: canvas day-1 authoring = presets + param tweaking + JSON editing in Objects view; no visual editor in U5; no compositor fork.
  - Status tracker: implementation must update the U5 row in the same commit.
- `docs/reports/2026-07-05-elv2-u1-u4-state.md`
  - U3 deleted the legacy pattern path and EffectCreator. Do not resurrect pattern authoring.
  - U4 landed `packages/core/src/canvas/*`, `GraphNode.playType`, `GraphNode.canvasScene`, and `canvas:<sceneId>` registry resolution.
- `AGENTS.md`
  - UI work must use/extend the design system, regenerate `docs/design-system.html`, and verify with `pnpm ui-shot`.

Core rule: **Canvas is authored data, not a second render path.** A canvas play node still emits a normal play action. The voice pool hosts `canvas:<sceneId>` as the generator id. The compositor and generator bridge stay untouched.

---

## 1. Current-code anchors

Line numbers are from current `main` at plan time. Re-anchor by symbol if the file drifts.

| Concern | Anchor |
|---|---|
| PlayType taxonomy and labels | `packages/core/src/effects/vocabulary.ts:55-74` |
| Total effect→type inference | `packages/core/src/effects/registry.ts:136-142` |
| GraphNode canvas fields | `packages/core/src/voice/types.ts:220-244` |
| `voice.Show` currently lacks scene docs | `packages/core/src/voice/types.ts:380-408` |
| PlayAction already carries canvas metadata | `packages/core/src/voice/eval-graph.ts:31-39`, `:170-193` |
| Canvas scene data model | `packages/core/src/canvas/types.ts:27-116` |
| Canvas registry seam | `packages/core/src/canvas/registry.ts:18-53` |
| Canvas id convention | `packages/core/src/canvas/ids.ts:10-24` |
| Canvas generator adapter + params | `packages/core/src/canvas/scene.ts:28-39`, `:56-162` |
| Effects registry resolves `canvas:<id>` | `packages/core/src/effects/registry.ts:121-125` |
| VoicePool hosts canvas generator id | `packages/core/src/voice/voice-pool.ts:86-122` |
| Web fixture maps core param specs | `apps/web/src/lib/trigger-lab/fixtures.ts:96-135` |
| Store authored snapshot/restore | `apps/web/src/lib/trigger-lab/store.svelte.ts:982-1028` |
| Store add-node seam | `apps/web/src/lib/trigger-lab/store.svelte.ts:2635-2664` |
| Gallery open/pick seams | `apps/web/src/lib/trigger-lab/store.svelte.ts:2920-2928`, `:3037-3049` |
| Gallery UI | `apps/web/src/lib/trigger-lab/EffectGallery.svelte:30-168` |
| Trigger graph add palette | `apps/web/src/lib/app/views/TriggerGraphView.svelte:78-153` |
| Trigger node face | `apps/web/src/lib/app/views/TriggerNode.svelte:64-78`, `:148-158`, `:248-262` |
| Shared node card | `apps/web/src/lib/app/views/NodeCard.svelte:12-37`, `:54-72` |
| Play inspector | `apps/web/src/lib/app/docks/inspectors/PlayNodeInspector.svelte:72-165` |
| Objects view | `apps/web/src/lib/app/views/ObjectsView.svelte:61-162` |
| Objects pure rows | `apps/web/src/lib/app/views/objects-view.ts:11-15`, `:143-153` |
| ClipDoc closure | `apps/web/src/lib/trigger-lab/clipdoc.ts:52-62`, `:170-206` |
| setShow reaches voice host | `apps/server/src/handlers/voice-input.ts:70-72`; `apps/server/src/voice-engine-host.ts:207-213` |

---

## 2. Target behavior

1. Trigger graph Add palette has a **Play** group with one item per `COLLECTIONS` play type.
2. Adding a typed play node sets `node.playType` and seeds a matching effect. Adding Canvas creates/selects a scene, sets `canvasScene`, `effectId = canvas:<sceneId>`, and seeds canvas params.
3. Effect Gallery opens pre-filtered and locked to the node’s `playType`. The store rejects mismatched picks as a backstop.
4. Play node face shows a type chip from `collectionMeta(node.playType).label`.
5. Canvas play node Inspector shows a scene picker and uses existing generic param controls for `CANVAS_PARAM_SPEC`.
6. Objects view gains **Canvas Scenes** with create/rename/duplicate/delete and JSON editing.
7. User-authored scenes persist in the show document, sync to server/viewers, and travel through graph/section/song ClipDoc copy-paste.
8. Connected voice mode registers show scenes before the first hit; offline preview and connected output both use the generator seam.

---

## 3. Implementation sequence

1. Core show scene registration.
2. Web canvas-scene authored state and helper module.
3. Show builder/store integration with virtual canvas `EffectDef`s and default presets.
4. Typed play palette, locked gallery, node type chip.
5. Canvas Inspector scene picker and Objects view JSON authoring.
6. ClipDoc + Song Library closure portability.
7. Tests, design-system update, ui-shot captures, U5 report, tracker update.

---

## 4. Core changes

### 4.1 `packages/core/src/voice/types.ts`

Add:

```ts
import type { CanvasScene } from '../canvas/types';
```

Extend `Show` additively:

```ts
export interface Show {
  buses: Bus[];
  graphs: Record<string, TriggerGraph>;
  sections: Section[];
  effects: EffectDef[];
  presets: Preset[];
  /**
   * User-authored canvas scene documents. The engine registers these into the
   * pure canvas registry on setShow() so `canvas:<sceneId>` resolves through
   * the normal EffectGenerator lookup.
   */
  canvasScenes?: CanvasScene[];
  songs?: ShowSong[];
}
```

### 4.2 `packages/core/src/voice/engine.ts`

Import:

```ts
import { registerCanvasScene, unregisterCanvasScene } from '../canvas/registry';
import type { CanvasScene } from '../canvas/types';
```

Add to `VoiceBusEngine`:

```ts
private readonly registeredCanvasSceneIds = new Set<string>();

private syncCanvasScenes(scenes: readonly CanvasScene[] | undefined): void {
  const nextIds = new Set((scenes ?? []).map((scene) => scene.id));

  for (const id of [...this.registeredCanvasSceneIds]) {
    if (!nextIds.has(id)) {
      unregisterCanvasScene(id);
      this.registeredCanvasSceneIds.delete(id);
    }
  }

  for (const scene of scenes ?? []) {
    registerCanvasScene(scene);
    this.registeredCanvasSceneIds.add(scene.id);
  }
}
```

Call first in `setShow`:

```ts
setShow(show: Show): void {
  this.syncCanvasScenes(show.canvasScenes);
  this.show = show;
  this.busById = new Map(show.buses.map((b) => [b.id, b] as const));
  this.effectsById = new Map(show.effects.map((e) => [e.id, e] as const));
  this.presetsById = new Map(show.presets.map((p) => [p.id, p] as const));
  // existing body unchanged...
}
```

Why this matters: `VoicePool.spawn()` checks `effectsById.get(a.effectId)` and then sets `slot.generatorId = canvasEffectId(a.canvasScene)` for canvas nodes. The generator bridge later resolves `canvas:<sceneId>` through `tryGetEffect()`. Without registration, connected canvas nodes render black.

### 4.3 Core tests

Add `packages/core/src/voice/canvas-show.test.ts`.

Required cases:

- `setShow({ canvasScenes })` registers scenes and `tryGetEffect(canvas:<id>)` resolves.
- Replacing the show unregisters stale scene ids.
- A canvas play graph with virtual `EffectDef` + `canvasScene` spawns/renders without compositor changes.

---

## 5. Web canvas-scene helper module

Create `apps/web/src/lib/trigger-lab/store/canvas-scenes.ts`.

```ts
import {
  CANVAS_PARAM_SPEC,
  canvasEffectId,
  canvasSceneIdOf,
  collectionMeta,
  type CanvasScene,
  type PlayType,
} from '@ledrums/core';
import { mapParamSpec } from '../fixtures';
import { defaultParams, type EffectDef, type GraphNode, type Preset, type TriggerGraph } from '../sim';

export const CANVAS_BUS_ID = 'base';

export function makeCanvasScene(id: string, name = 'New canvas scene'): CanvasScene {
  return {
    id,
    name,
    description: 'Authored canvas scene sampled through the drum kit.',
    tags: ['canvas'],
    sampler: { kind: 'cylinder' },
    lenses: [],
    elements: [
      { kind: 'stripes', angleDeg: 0, widthU: 0.18, duty: 0.5, speedUps: 0.25, hue: 140, sat: 1, softness: 0.08 },
    ],
  };
}

export function canvasEffectDef(scene: CanvasScene): EffectDef {
  const id = canvasEffectId(scene.id);
  return {
    id,
    name: scene.name,
    generatorId: id,
    category: 'texture',
    description: scene.description,
    tags: ['canvas', ...(scene.tags ?? []).filter((tag) => tag !== 'canvas')],
    playType: 'canvas',
    busId: CANVAS_BUS_ID,
    scope: 'kit',
    params: CANVAS_PARAM_SPEC.map(mapParamSpec),
    attackMs: 800,
    sustainMs: 0,
    releaseMs: 900,
  };
}

export function canvasDefaultPreset(scene: CanvasScene): Preset {
  const eff = canvasEffectDef(scene);
  return { id: `${eff.id}:default`, name: 'Default', effectId: eff.id, params: defaultParams(eff) };
}

export function sceneRefsInGraph(graph: TriggerGraph): string[] {
  const out = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'play') continue;
    const sceneId = node.canvasScene ?? canvasSceneIdOf(node.effectId);
    if (sceneId) out.add(sceneId);
  }
  return [...out];
}

export function retargetSceneRefs(
  graphs: Record<string, TriggerGraph>,
  oldSceneId: string,
  fallback: CanvasScene | null,
): Record<string, TriggerGraph> {
  const fallbackEffect = fallback ? canvasEffectDef(fallback) : null;
  const fallbackPreset = fallback ? canvasDefaultPreset(fallback) : null;
  const out: Record<string, TriggerGraph> = {};

  for (const [key, graph] of Object.entries(graphs)) {
    let changed = false;
    const nodes = graph.nodes.map((node) => {
      if (node.kind !== 'play') return node;
      const sceneId = node.canvasScene ?? canvasSceneIdOf(node.effectId);
      if (sceneId !== oldSceneId) return node;
      changed = true;
      if (!fallback || !fallbackEffect || !fallbackPreset) {
        return { ...node, effectId: '', presetId: '', canvasScene: undefined, params: {}, playType: 'canvas' as PlayType };
      }
      return {
        ...node,
        playType: 'canvas' as PlayType,
        canvasScene: fallback.id,
        effectId: fallbackEffect.id,
        presetId: fallbackPreset.id,
        params: { ...fallbackPreset.params },
      };
    });
    out[key] = changed ? { ...graph, nodes } : graph;
  }
  return out;
}

export function formatCanvasScene(scene: CanvasScene): string {
  return JSON.stringify(scene, null, 2);
}

export type SceneJsonResult =
  | { ok: true; scene: CanvasScene }
  | { ok: false; message: string };

export function parseCanvasSceneJson(id: string, text: string): SceneJsonResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Invalid JSON.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Scene JSON must be an object.' };
  const scene = raw as Partial<CanvasScene>;
  if (scene.id !== id) return { ok: false, message: 'Scene id is stable; duplicate the scene instead of editing its id.' };
  if (typeof scene.name !== 'string' || !scene.name.trim()) return { ok: false, message: 'Scene name is required.' };
  if (!Array.isArray(scene.elements)) return { ok: false, message: 'Scene elements must be an array.' };
  if (!scene.sampler || typeof scene.sampler !== 'object') return { ok: false, message: 'Scene sampler is required.' };
  return { ok: true, scene: scene as CanvasScene };
}

export function collectionLabel(type: PlayType): string {
  return collectionMeta(type).label;
}
```

Keep this pure. Tests should cover it heavily.

---

## 6. Persistence and store integration

### 6.1 `apps/web/src/lib/trigger-lab/persistence.ts`

Import:

```ts
import type { CanvasScene } from '@ledrums/core';
```

Add to `AuthoredState`:

```ts
canvasScenes?: CanvasScene[];
```

Add to `coerceAuthored`:

```ts
if (Array.isArray(data.canvasScenes)) out.canvasScenes = data.canvasScenes as CanvasScene[];
```

No `VERSION` bump: additive fields are explicitly tolerated by this persistence module.

### 6.2 Store authored rune and derived registry

In `apps/web/src/lib/trigger-lab/store.svelte.ts`:

```ts
import { canvasEffectId, type CanvasScene, type PlayType } from '@ledrums/core';
import * as canvasScenesLib from './store/canvas-scenes';
```

Add state:

```ts
canvasScenes = $state<CanvasScene[]>([]);
```

Add derived helpers:

```ts
get canvasEffects(): EffectDef[] {
  return this.canvasScenes.map(canvasScenesLib.canvasEffectDef);
}

get selectableEffects(): EffectDef[] {
  return [...this.effects, ...this.canvasEffects];
}

get allPresets(): Preset[] {
  const existing = new Set(this.presets.map((p) => p.id));
  const canvasDefaults = this.canvasScenes
    .map(canvasScenesLib.canvasDefaultPreset)
    .filter((p) => !existing.has(p.id));
  return [...this.presets, ...canvasDefaults];
}
```

Update lookup methods to use these:

```ts
effectOf(node: GraphNode) {
  return node.kind === 'play' ? this.selectableEffects.find((e) => e.id === node.effectId) : undefined;
}

presetById(id: string): Preset | undefined {
  return this.allPresets.find((p) => p.id === id);
}

presetsForEffect(effectId: string): Preset[] {
  return this.allPresets.filter((p) => p.effectId === effectId);
}
```

### 6.3 Authored snapshot / restore

In `toAuthored()` add:

```ts
canvasScenes: this.canvasScenes,
```

In `applyAuthored()` add:

```ts
this.canvasScenes = a.canvasScenes ?? [];
```

Assign even when absent, so switching from a scene-heavy show to a scene-less show clears prior scenes.

### 6.4 Show builder

In `apps/web/src/lib/trigger-lab/show-builder.ts`:

```ts
import type { CanvasScene } from '@ledrums/core';

export interface ShowSource {
  buses: Bus[];
  graphs: Record<string, TriggerGraph>;
  sections: Section[];
  effects: EffectDef[];
  presets: Preset[];
  canvasScenes?: CanvasScene[];
  drums: { id: string }[];
  songs?: Song[];
}
```

Return scene docs in `buildShow`:

```ts
return {
  buses: source.buses.map((b) => ({ ...b })),
  graphs: aliasResolvedGraphs(source.graphs),
  sections: source.sections.map((s) => ({ ...s, looks: { ...s.looks } })),
  effects: source.effects.map((e) => ({ ...e })),
  presets: source.presets.map((p) => ({ ...p })),
  canvasScenes: (source.canvasScenes ?? []).map((scene) => structuredClone(scene)),
  songs: /* existing mapping */,
};
```

In the store `showSource` getter, send virtual canvas effects/presets:

```ts
private get showSource(): ShowSource {
  const rv = this.resolvedView;
  return {
    buses: this.buses,
    graphs: rv.graphs,
    sections: this.sections,
    effects: [...rv.effects, ...this.canvasEffects],
    presets: [
      ...rv.presets,
      ...this.allPresets.filter((p) => p.effectId.startsWith('canvas:')),
    ],
    canvasScenes: this.canvasScenes,
    drums: this.drums,
    songs: this.resolvedSongs,
  };
}
```

If Song Library references later resolve scene docs into `resolvedView`, switch `canvasScenes` and canvas virtual effects to that resolved source.

### 6.5 Scene CRUD mutators

Add methods to `TriggerLab`:

```ts
createCanvasScene(name?: string): string {
  if (this.isViewer) return '';
  const id = freshId('scene', (candidate) => this.canvasScenes.some((scene) => scene.id === candidate));
  const scene = canvasScenesLib.makeCanvasScene(id, name?.trim() || `Canvas scene ${this.canvasScenes.length + 1}`);
  this.canvasScenes = [...this.canvasScenes, scene];
  return id;
}

renameCanvasScene(id: string, name: string): void {
  if (this.isViewer) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  this.canvasScenes = this.canvasScenes.map((scene) => (scene.id === id ? { ...scene, name: trimmed } : scene));
}

duplicateCanvasScene(id: string): string | null {
  if (this.isViewer) return null;
  const src = this.canvasScenes.find((scene) => scene.id === id);
  if (!src) return null;
  const nextId = freshId('scene', (candidate) => this.canvasScenes.some((scene) => scene.id === candidate));
  const clone: CanvasScene = structuredClone({ ...src, id: nextId, name: `${src.name} copy` });
  this.canvasScenes = [...this.canvasScenes, clone];
  return nextId;
}

deleteCanvasScene(id: string): boolean {
  if (this.isViewer) return false;
  const exists = this.canvasScenes.some((scene) => scene.id === id);
  if (!exists) return false;
  const remaining = this.canvasScenes.filter((scene) => scene.id !== id);
  const fallback = remaining[0] ?? null;
  this.canvasScenes = remaining;
  this.graphs = canvasScenesLib.retargetSceneRefs(this.graphs, id, fallback);
  const deletedEffectId = canvasEffectId(id);
  this.presets = this.presets.filter((preset) => preset.effectId !== deletedEffectId);
  return true;
}

canvasSceneJson(id: string): string {
  const scene = this.canvasScenes.find((s) => s.id === id);
  return scene ? canvasScenesLib.formatCanvasScene(scene) : '';
}

updateCanvasSceneJson(id: string, text: string): { ok: true } | { ok: false; message: string } {
  if (this.isViewer) return { ok: false, message: 'This show is read-only.' };
  const parsed = canvasScenesLib.parseCanvasSceneJson(id, text);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  this.canvasScenes = this.canvasScenes.map((scene) => (scene.id === id ? parsed.scene : scene));
  return { ok: true };
}

setCanvasScene(node: GraphNode, sceneId: string): void {
  if (this.isViewer || node.kind !== 'play') return;
  const scene = this.canvasScenes.find((s) => s.id === sceneId);
  if (!scene) return;
  const eff = canvasScenesLib.canvasEffectDef(scene);
  const preset = this.presetById(`${eff.id}:default`) ?? canvasScenesLib.canvasDefaultPreset(scene);
  node.playType = 'canvas';
  node.canvasScene = scene.id;
  node.effectId = eff.id;
  node.scope = eff.scope;
  node.presetId = preset.id;
  node.busId = '';
  node.params = { ...preset.params };
  node.env = {};
}
```

### 6.6 Typed play-node creation

Add:

```ts
addPlayNode(playType: PlayType, x: number, y: number): GraphNode | null {
  if (this.isViewer) return null;
  const g = this.selectedGraph;
  if (!g) return null;

  let node: GraphNode;
  if (playType === 'canvas') {
    const sceneId = this.canvasScenes[0]?.id ?? this.createCanvasScene('New canvas scene');
    const scene = this.canvasScenes.find((s) => s.id === sceneId);
    if (!scene) return null;
    const eff = canvasScenesLib.canvasEffectDef(scene);
    const preset = this.presetById(`${eff.id}:default`) ?? canvasScenesLib.canvasDefaultPreset(scene);
    node = makeNode('play', nid('n'), x, y, {
      playType: 'canvas',
      canvasScene: scene.id,
      effectId: eff.id,
      presetId: preset.id,
      scope: eff.scope,
      params: { ...preset.params },
    });
  } else {
    const eff = this.selectableEffects.find((e) => !e.deprecated && e.playType === playType)
      ?? this.selectableEffects.find((e) => !e.deprecated);
    if (!eff) return null;
    const preset = this.presetById(`${eff.id}:default`);
    node = makeNode('play', nid('n'), x, y, {
      playType,
      effectId: eff.id,
      presetId: `${eff.id}:default`,
      scope: eff.scope,
      params: { ...(preset?.params ?? defaultParams(eff)) },
    });
  }

  g.nodes.push(node);
  return node;
}
```

Keep `addNode('play', ...)` working for old callers, but route it to a deliberate default typed play node.

### 6.7 Guard `pickEffect`

```ts
pickEffect(node: GraphNode, effectId: string): void {
  if (this.isViewer || node.kind !== 'play') return;
  const eff = this.selectableEffects.find((e) => e.id === effectId);
  if (!eff) return;

  const nodeType = node.playType ?? eff.playType ?? 'ambient';
  if (eff.playType !== nodeType) return;

  if (nodeType === 'canvas') {
    const sceneId = effectId.slice('canvas:'.length);
    this.setCanvasScene(node, sceneId);
    return;
  }

  const pr = this.presetById(`${effectId}:default`);
  node.effectId = effectId;
  node.playType = nodeType;
  node.canvasScene = undefined;
  node.scope = eff.scope;
  node.presetId = `${effectId}:default`;
  node.busId = '';
  node.params = { ...(pr?.params ?? defaultParams(eff)) };
  node.env = {};
}
```

---

## 7. UI changes

### 7.1 Typed Add palette

In `apps/web/src/lib/app/views/TriggerGraphView.svelte` import:

```ts
import { COLLECTIONS, type PlayType } from '@ledrums/core';
```

Change `addGroups`:

```ts
const addGroups = $derived<AddGroup[]>([
  {
    key: 'play',
    label: 'Play',
    items: COLLECTIONS.map((c) => ({
      id: c.type,
      name: c.label,
      icon: kindIcon.play,
      tint: tint.play,
      hint: c.blurb,
    })),
  },
  {
    key: 'kinds',
    label: 'Nodes',
    items: NODE_KINDS
      .filter((kind) => kind !== 'play' && kind !== 'modifier' && !voice.isModSourceKind(kind))
      .map((kind) => ({ id: kind, name: kindLabel[kind], icon: kindIcon[kind], tint: tint[kind] })),
  },
  // existing modulation + modifier groups
]);
```

Update dispatch:

```ts
function handleAdd(id: string, groupKey: string): void {
  const c = canvasCentre();
  if (groupKey === 'play') addPlayNodeAt(id as PlayType, c.x, c.y);
  else if (groupKey.startsWith(MODIFIER_GROUP_PREFIX)) addModifierNodeAt(id, c.x, c.y);
  else addNodeAt(id as NodeKind, c.x, c.y);
}

function addPlayNodeAt(playType: PlayType, cx: number, cy: number): void {
  const p = spawnAt(cx, cy);
  store.addPlayNode(playType, p.x, p.y);
}
```

### 7.2 Locked gallery

In `EffectGallery.svelte` add:

```ts
import { COLLECTIONS, collectionMeta, type PlayType } from '@ledrums/core';

const lockedPlayType = $derived<PlayType | null>(block?.kind === 'play' ? (block.playType ?? null) : null);
const lockedMeta = $derived(lockedPlayType ? collectionMeta(lockedPlayType) : null);
```

Use `store.selectableEffects`, filter by lock, and show a locked pill:

```ts
const pool = $derived(
  store.selectableEffects.filter((e) =>
    !e.deprecated &&
    e.scope === scope &&
    (!lockedPlayType || playTypeOf(e) === lockedPlayType)
  )
);
```

```svelte
{#if lockedMeta}
  <Pill tone="accent" label={`Locked: ${lockedMeta.label}`} />
{/if}
```

Tabs should collapse to the locked collection when `lockedPlayType` is present. The store guard remains the authoritative protection.

### 7.3 Node type chip

In `NodeCard.svelte`, add optional `typeChip?: string` and render it in the head. Keep optional so Patch nodes are unaffected.

Recommended CSS:

```css
.typechip {
  grid-area: chip;
  justify-self: start;
  max-width: 100%;
  padding: 1px 6px;
  border: 1px solid color-mix(in oklch, var(--tint) 45%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in oklch, var(--tint) 12%, transparent);
  color: var(--tint);
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: var(--tracking-label);
}
```

In `TriggerNode.svelte`:

```ts
import { collectionMeta } from '@ledrums/core';

const playTypeChip = $derived.by(() => {
  if (!node || node.kind !== 'play') return undefined;
  const type = node.playType ?? eff?.playType ?? 'ambient';
  return collectionMeta(type).label;
});
```

Pass `typeChip={playTypeChip}` into `NodeCard`.

### 7.4 Canvas Inspector

In `PlayNodeInspector.svelte`:

```ts
const isCanvas = $derived((node.playType ?? eff?.playType) === 'canvas');
const sceneOptions = $derived(store.canvasScenes.map((scene) => ({ value: scene.id, label: scene.name })));
```

After the header:

```svelte
{#if isCanvas}
  <div class="sceneRow">
    <span class="k">Scene</span>
    <Select
      value={node.canvasScene ?? ''}
      options={sceneOptions}
      onChange={(v) => store.setCanvasScene(node, v)}
      placeholder="Choose scene"
      ariaLabel="Canvas scene"
      class="sceneSelect"
    />
    <IconButton icon={BookmarkPlus} label="New canvas scene" variant="soft" size={14} onclick={() => store.setCanvasScene(node, store.createCanvasScene())} />
  </div>
{/if}
```

Do **not** special-case params. The existing param loop over `eff.params` should render canvas params from `CANVAS_PARAM_SPEC`.

---

## 8. Objects view Canvas Scenes

### 8.1 `objects-view.ts`

Add `canvas-scenes` to `ObjectTypeId` and `OBJECT_TYPE_IDS`, then add:

```ts
import type { CanvasScene } from '@ledrums/core';

export interface CanvasSceneRow {
  id: string;
  name: string;
  elementCount: number;
  lensCount: number;
  sampler: string;
}

export function canvasSceneRows(scenes: readonly CanvasScene[]): CanvasSceneRow[] {
  return scenes
    .map((scene) => ({
      id: scene.id,
      name: scene.name,
      elementCount: scene.elements.length,
      lensCount: scene.lenses?.length ?? 0,
      sampler: scene.sampler.kind,
    }))
    .sort(byNameThenId);
}
```

### 8.2 New `CanvasSceneRow.svelte`

Create `apps/web/src/lib/app/views/CanvasSceneRow.svelte`.

Implement as a row plus expanded JSON editor. Use `EditableRow`, `ContextMenu`, `ConfirmDialog`, and `IconButton` just like existing rows.

Core behavior:

- clicking row selects it
- rename calls `store.renameCanvasScene`
- duplicate calls `store.duplicateCanvasScene`
- delete asks confirmation then calls `store.deleteCanvasScene`
- expanded JSON editor uses `store.canvasSceneJson(scene.id)` for draft
- save calls `store.updateCanvasSceneJson(scene.id, draft)`
- invalid JSON displays inline error and does not mutate state
- id edits are rejected by `parseCanvasSceneJson`

### 8.3 `ObjectsView.svelte`

Add type to rail:

```ts
{ id: 'canvas-scenes', label: 'Canvas Scenes', icon: Shapes }
```

Add row list:

```ts
const canvasScenes = $derived(canvasSceneRows(store.canvasScenes));
```

Add create button when selected:

```svelte
{#if type === 'canvas-scenes' && store.canEdit}
  <IconButton icon={Plus} label="New canvas scene" size={14} onclick={() => (selectedId = store.createCanvasScene())} />
{/if}
```

Add detail branch:

```svelte
{:else if type === 'canvas-scenes'}
  {#each canvasScenes as scene (scene.id)}
    <CanvasSceneRow {store} scene={scene} active={selectedId === scene.id} onSelect={() => (selectedId = scene.id)} />
  {/each}
  {#if canvasScenes.length === 0}
    <p class="empty">No canvas scenes yet. Create one to author canvas-backed play nodes.</p>
  {/if}
{:else}
  <!-- existing presets branch -->
{/if}
```

---

## 9. ClipDoc and Song Library portability

Extend `ClipDocDeps` in `clipdoc.ts`:

```ts
import { canvasEffectId, canvasSceneIdOf, type CanvasScene } from '@ledrums/core';

export interface ClipDocDeps {
  graphs?: Record<string, TriggerGraph>;
  graphNames?: Record<string, string>;
  effects?: EffectDef[];
  presets?: Preset[];
  canvasScenes?: CanvasScene[];
}
```

Add helper:

```ts
function graphSceneRefs(graph: TriggerGraph): Set<string> {
  const out = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'play') continue;
    const sceneId = node.canvasScene ?? canvasSceneIdOf(node.effectId);
    if (sceneId) out.add(sceneId);
  }
  return out;
}

function scenesForGraphs(graphs: Record<string, TriggerGraph>, scenes: readonly CanvasScene[] | undefined): CanvasScene[] {
  const wanted = new Set<string>();
  for (const graph of Object.values(graphs)) for (const id of graphSceneRefs(graph)) wanted.add(id);
  return (scenes ?? []).filter((scene) => wanted.has(scene.id)).map((scene) => structuredClone(scene));
}
```

Add `canvasScenes` into graph/section/song deps.

During remap/materialization:

```ts
function remapCanvasNode(node: GraphNode, sceneIdMap: Map<string, string>): GraphNode {
  if (node.kind !== 'play') return node;
  const oldSceneId = node.canvasScene ?? canvasSceneIdOf(node.effectId);
  if (!oldSceneId) return node;
  const nextSceneId = sceneIdMap.get(oldSceneId) ?? oldSceneId;
  return {
    ...node,
    playType: 'canvas',
    canvasScene: nextSceneId,
    effectId: canvasEffectId(nextSceneId),
    presetId: node.presetId.startsWith(canvasEffectId(oldSceneId))
      ? node.presetId.replace(canvasEffectId(oldSceneId), canvasEffectId(nextSceneId))
      : node.presetId,
  };
}
```

Also extend `store/song-library.ts` closure types and resolved view with `canvasScenes?: CanvasScene[]`. A referenced song that contains canvas nodes must send its scene docs through `showSource`, otherwise the server receives graphs with `canvas:<id>` but no scene registry entry.

---

## 10. Tests to add

### Core

- `packages/core/src/voice/canvas-show.test.ts`
  - setShow registers scene docs
  - later show unregisters stale scene ids
  - canvas play graph can resolve `canvas:<id>` through `tryGetEffect`

### Web pure

- `apps/web/src/lib/trigger-lab/store/canvas-scenes.test.ts`
  - `canvasEffectDef` creates `playType:'canvas'`, `generatorId:'canvas:<id>'`, tags containing `canvas`, params matching `CANVAS_PARAM_SPEC`
  - JSON parse accepts valid scene, rejects changed id, missing elements, missing sampler
  - `retargetSceneRefs` retargets or clears nodes after delete

- `apps/web/src/lib/trigger-lab/persistence.canvas-scenes.test.ts`
  - `canvasScenes` round-trips through `coerceAuthored`
  - missing scenes field does not wedge boot

- `apps/web/src/lib/trigger-lab/show-builder.canvas-scenes.test.ts`
  - `buildShow` includes `canvasScenes`
  - `buildShow` includes canvas virtual effects/presets supplied by store source
  - graph node `canvasScene` survives structural assignment into `voice.Show`

- `apps/web/src/lib/trigger-lab/clipdoc.canvas-scenes.test.ts`
  - graph copy includes scene deps
  - paste remaps scene id and rewrites `canvasScene`, `effectId`, canvas preset ids
  - section/song copy dedupes scenes

### Store/UI

- `apps/web/src/lib/trigger-lab/store.canvas-scenes.test.ts`
  - `createCanvasScene`
  - `addPlayNode('canvas')`
  - `addPlayNode('particles')` selects a particle effect only
  - `pickEffect` rejects mismatched play type
  - `setCanvasScene`
  - `deleteCanvasScene`

- `apps/web/src/lib/app/views/objects-view.test.ts`
  - `canvasSceneRows` sort/counts
  - `ObjectTypeId` includes `canvas-scenes`

Component tests if existing harness makes them cheap:

- locked EffectGallery only shows matching `playType`
- PlayNodeInspector renders scene picker + canvas sliders for canvas nodes

---

## 11. UI-shot checklist

Capture against the dev server (`:4321` / `:5173`):

1. `u5-typed-play-palette` — Trigger Add tab, Play group with seven types.
2. `u5-node-type-chip` — Trigger graph play node showing type chip.
3. `u5-gallery-locked` — Gallery opened from a Particles or Canvas node, locked to that collection.
4. `u5-canvas-inspector` — Canvas node Inspector showing scene picker and canvas params.
5. `u5-canvas-scenes-objects` — Objects view Canvas Scenes section with JSON editor.

If the known `effect-gallery` named shot is still broken, use targeted/ad-hoc captures and document commands/paths in the U5 report.

---

## 12. Design system

Update `apps/web/src/lib/styleguide/` with demos for:

- `NodeCard` with `typeChip`
- `AddPalette` with Play group
- Canvas Scene row/editor if reusable

Then run:

```bash
pnpm design-system
```

---

## 13. Required U5 report

Create `docs/reports/2026-07-05-elv2-u5-report.md` with this structure:

```md
# Effects Library v2 — U5 report

## What shipped
- Typed play-node palette ...
- Gallery lock ...
- Canvas scene documents ...

## Persistence shape
- Web authored state: `AuthoredState.canvasScenes?: CanvasScene[]`.
- Engine show: `voice.Show.canvasScenes?: CanvasScene[]`.
- Canvas virtual effects: `EffectDef.id = canvas:<sceneId>`, `generatorId = canvas:<sceneId>`, `playType = canvas`.
- Canvas default presets: derived/persisted behavior ...

## Scene CRUD / JSON editor
- Create / rename / duplicate / delete behavior.
- Delete retarget behavior.
- JSON validation rules.

## Scene-param authoring surface
- Scene picker in PlayNodeInspector.
- Generic params from `CANVAS_PARAM_SPEC`.
- Preset apply/save behavior.

## Clipboard / Song Library portability
- Which ClipDoc deps carry scenes.
- How scene ids are remapped.

## U6 instructions
- How to add seed scenes.
- Whether U6 should place seeds in `packages/core/src/canvas/presets.ts` or web fixtures.
- Exact helper to call to expose a scene in the gallery.

## Verification
- Commands run.
- ui-shot names/paths.
```

---

## 14. Status tracker update

In `docs/plans/2026-07-05-effects-library-v2.md`, update only the U5 row from issued to done:

```md
| U5 canvas UI | done | <commit shas> | Typed play palette; gallery locked to playType; node type chip; Canvas scene picker + params; Objects Canvas Scenes JSON editor; show-doc scene persistence + ClipDoc portability. Report: `docs/reports/2026-07-05-elv2-u5-report.md`. |
```

Do not mark U6 or U7 done.

---

## 15. Verification commands

Minimum gates:

```bash
pnpm typecheck
pnpm --filter '!@ledrums/desktop' -r test
pnpm design-system
pnpm ui-shot
```

If `pnpm ui-shot` is partially blocked by the known gallery shot timeout, use targeted captures and document that explicitly.

---

## 16. Failure modes to avoid

1. **Scene registered only in browser.** Offline preview works, connected engine renders black. Fix: `voice.Show.canvasScenes` + core `setShow()` registry sync.
2. **Virtual canvas EffectDef not sent in `show.effects`.** `VoicePool.spawn()` returns null before it can host `canvas:<id>`. Fix: include `canvasEffectDef(scene)` in show source effects.
3. **Gallery only visually locked.** Stale callbacks can pick wrong effects. Fix: `store.pickEffect()` rejects mismatched `playType`.
4. **Scene delete leaves dangling refs.** Fix: retarget to fallback or clear canvas nodes; remove saved presets for deleted `canvas:<id>`.
5. **ClipDoc copies graphs but not scenes.** Paste succeeds visually but renders black elsewhere. Fix: scene deps + id remap.
6. **Persisting synthetic canvas effects as real effects.** This creates duplicate virtual effects. Prefer derived `canvasEffects`; persist scene docs and user-saved presets only.
7. **JSON editor allows id edits.** Reject id edits; duplicate is the supported new-id path.
8. **Design-system skipped.** Add demos and regenerate.

---

## 17. Suggested implementation PR summary

```md
## Summary
- Added show-owned CanvasScene persistence and core setShow scene registration so `canvas:<sceneId>` resolves in connected voice mode.
- Added typed Play palette, playType-locked EffectGallery, node-face type chips, and Canvas scene picker/param controls.
- Added Objects → Canvas Scenes JSON authoring with create/rename/duplicate/delete.
- Extended ClipDoc/song-library closure handling so canvas scenes travel with graph/section/song copy-paste.
- Added U5 handoff report and updated Effects Library v2 tracker.

## Verification
- pnpm typecheck
- pnpm --filter '!@ledrums/desktop' -r test
- pnpm design-system
- pnpm ui-shot / targeted captures: ...
```
