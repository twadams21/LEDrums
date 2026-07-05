# Effects Library v2 U5 — implementation plan

Issue: #58 — Typed play nodes UI + Canvas authoring UI

Status of this file: implementation handoff only. It is intentionally prescriptive: an implementation agent should be able to follow the file path list, paste/adapt the snippets, add the tests, and avoid rediscovering the U1–U4 context.

Verified against `main` after U1–U4 landed. The earlier state-report warning about Trent WIP files is superseded by the 2026-07-05 chat note: there are no remaining WIP files to avoid.

---

## 0. Non-negotiables for the implementer

Read these before editing:

- `docs/plans/2026-07-05-effects-library-v2.md`
  - D3 typed play nodes: `playType` is the same taxonomy as gallery collections; gallery swap is locked to that type; engine stays uniform underneath.
  - D4 canvas engine: scene documents are data, resolved as `canvas:<sceneId>` through the existing EffectGenerator seam.
  - Decisions table: canvas authoring day-1 is presets + param tweaking + JSON scene editing; no visual scene editor in U5; no compositor fork.
  - Status tracker: update the U5 row in the same implementation commit.
- `docs/reports/2026-07-05-elv2-u1-u4-state.md`
  - U3 deleted the legacy pattern path and EffectCreator. Do not resurrect pattern authoring.
  - U4 landed `packages/core/src/canvas/*`, `GraphNode.playType`, `GraphNode.canvasScene`, and `canvas:<sceneId>` registry resolution.
- `AGENTS.md`
  - UI work must use/extend the design system, regenerate `docs/design-system.html`, and verify with `pnpm ui-shot`.

Implementation rule: **Canvas is authored data, not a second render path.** A canvas play node still produces a normal play action. The voice pool hosts `canvas:<sceneId>` as the generator id; the compositor and generator bridge stay untouched.

---

## 1. Current-code anchors

Line numbers are from current `main` at the time this plan was written. Re-anchor by symbol if the file drifts.

| Concern | Anchor |
|---|---|
| PlayType taxonomy and labels | `packages/core/src/effects/vocabulary.ts:55-74` (`PlayType`, `COLLECTIONS`) |
| Total type inference | `packages/core/src/effects/registry.ts:136-142` / `playTypeForEffect()` |
| GraphNode canvas fields | `packages/core/src/voice/types.ts:220-244` (`playType?`, `canvasScene?`) |
| `voice.Show` currently lacks scene docs | `packages/core/src/voice/types.ts:380-408` |
| PlayAction already carries canvas metadata | `packages/core/src/voice/eval-graph.ts:31-39` and `:170-193` |
| Canvas scene data model | `packages/core/src/canvas/types.ts:27-116` |
| Canvas registry seam | `packages/core/src/canvas/registry.ts:18-53` |
| Canvas id convention | `packages/core/src/canvas/ids.ts:10-24` |
| Canvas EffectGenerator adapter + param spec | `packages/core/src/canvas/scene.ts:28-39`, `:56-162` |
| Effects registry resolves `canvas:<id>` | `packages/core/src/effects/registry.ts:121-125` |
| VoicePool hosts canvas generator id | `packages/core/src/voice/voice-pool.ts:86-122` |
| Web fixture maps core param specs | `apps/web/src/lib/trigger-lab/fixtures.ts:96-135` |
| Web generator EffectDefs shape | `apps/web/src/lib/trigger-lab/fixtures.ts:141-163` |
| Store authored state snapshot | `apps/web/src/lib/trigger-lab/store.svelte.ts:982-1000` (`toAuthored`) |
| Store restore merge | `apps/web/src/lib/trigger-lab/store.svelte.ts:1005-1028` (`applyAuthored`) |
| Store add-node seam | `apps/web/src/lib/trigger-lab/store.svelte.ts:2635-2664` (`addNode`) |
| Gallery open/pick seams | `apps/web/src/lib/trigger-lab/store.svelte.ts:2920-2928`, `:3037-3049` |
| Gallery UI filters/cards | `apps/web/src/lib/trigger-lab/EffectGallery.svelte:30-108`, `:111-168` |
| Trigger graph Add palette | `apps/web/src/lib/app/views/TriggerGraphView.svelte:78-153` |
| Trigger node face | `apps/web/src/lib/app/views/TriggerNode.svelte:64-78`, `:148-158`, `:248-262` |
| Shared node card | `apps/web/src/lib/app/views/NodeCard.svelte:12-37`, `:54-72` |
| Play inspector | `apps/web/src/lib/app/docks/inspectors/PlayNodeInspector.svelte:72-165` |
| Objects view type rail/detail | `apps/web/src/lib/app/views/ObjectsView.svelte:61-162` |
| Objects pure rows | `apps/web/src/lib/app/views/objects-view.ts:11-15`, `:143-153` |
| ClipDoc dependency closure | `apps/web/src/lib/trigger-lab/clipdoc.ts:52-62`, `:170-206` |
| setShow reaches voice host | `apps/server/src/handlers/voice-input.ts:70-72`; `apps/server/src/voice-engine-host.ts:207-213` |

---

## 2. Target behavior

### User-visible

1. Trigger graph Add palette has a **Play** group with one item per `COLLECTIONS` play type:
   - Hits
   - Waves & Ripples
   - Particles & Air
   - Textures
   - Ambient & Base
   - Meters & Utility
   - Canvas
2. Adding one of those creates a `kind:'play'` node with:
   - `node.playType` set to the chosen `PlayType`.
   - an initial effect whose `effect.playType` matches the node type.
   - for Canvas, an initial scene exists and the node has `canvasScene`, `effectId = canvas:<sceneId>`, and default canvas params.
3. The Effect Gallery opens **pre-filtered and locked** to the node's `playType`. A Particle node cannot pick a Texture effect. A Canvas node only swaps among canvas scene effects.
4. Play nodes show a type chip on the node face. The chip uses the shared `COLLECTIONS` label, not a duplicate label table.
5. Canvas play nodes show an Inspector scene picker. Scene params use the existing generic param controls from `CANVAS_PARAM_SPEC`.
6. Objects view gains **Canvas Scenes**. It supports:
   - create
   - rename
   - duplicate
   - delete
   - JSON edit day-1
   - validation errors that do not mutate state
7. Authored scene documents persist in the show library, follow viewer/editor sync, and are included in the `setShow` sent to the server.
8. Clipboard portability includes canvas scene docs in graph / section / song copies.

### Runtime

1. Offline preview renders canvas nodes through the existing generator-only preview path.
2. Connected voice mode renders canvas nodes through `VoicePool`'s existing `canvasEffectId(sceneId)` host path.
3. `voice.setShow(show)` registers user-authored scenes before voices can spawn them and unregisters stale scene ids when a new show removes them.
4. No compositor fork, no new protocol message type, no pattern path resurrection.

---

## 3. Implementation order

Do this in seven small commits or one disciplined commit with these sections. The dependencies are real; do not start with UI before the document model exists.

1. Core show scene registration.
2. Web canvas-scene authored state and helpers.
3. Show builder + store integration + virtual canvas EffectDefs/presets.
4. Typed play palette + gallery lock + node-face chip.
5. Canvas Inspector + Objects view JSON authoring.
6. ClipDoc / song-library closure portability.
7. Tests, design-system, ui-shot, U5 report, tracker update.

---

## 4. Core: put scene docs into `voice.Show` and register them on `setShow`

### 4.1 `packages/core/src/voice/types.ts`

Add the import:

```ts
import type { CanvasScene } from '../canvas/types';
```

Extend `Show` additively. Keep it optional for old shows and tests.

```ts
export interface Show {
  buses: Bus[];
  graphs: Record<string, TriggerGraph>;
  sections: Section[];
  effects: EffectDef[];
  presets: Preset[];
  /**
   * User-authored canvas scene documents. Seed-library scenes can also ride here later,
   * but U5 only needs show-owned user scenes. The engine registers these into the pure
   * canvas registry on setShow() so `canvas:<sceneId>` resolves through the normal
   * EffectGenerator lookup. Optional for back-compat.
   */
  canvasScenes?: CanvasScene[];
  songs?: ShowSong[];
}
```

No schema duplication is needed here; `voice.Show` is plain authored data, not a zod project schema.

### 4.2 `packages/core/src/voice/engine.ts`

Import the pure canvas registry helpers. This stays inside `packages/core` and does not add IO.

```ts
import { registerCanvasScene, unregisterCanvasScene } from '../canvas/registry';
import type { CanvasScene } from '../canvas/types';
```

Add a registration set to `VoiceBusEngine`:

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

Call it first in `setShow`:

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

Why this must be core-side: `VoicePool.spawn()` looks up `a.effectId` in `effectsById`, then sets `slot.generatorId = canvasEffectId(a.canvasScene)` for canvas nodes. The generator bridge later resolves that generator id through `tryGetEffect()`. If scenes are not registered before the first hit, connected canvas nodes will silently render nothing.

### 4.3 Core tests

Add `packages/core/src/voice/canvas-show.test.ts`.

Test cases:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, buildPixelModel, canvasEffectId, tryGetCanvasScene, tryGetEffect, voice } from '@ledrums/core';

const scene = {
  id: 'scene-test',
  name: 'Scene Test',
  elements: [{ kind: 'stripes', angleDeg: 0, widthU: 0.2, duty: 0.5, speedUps: 0, hue: 120, sat: 1, softness: 0.05 }],
  sampler: { kind: 'cylinder' },
} satisfies import('@ledrums/core').CanvasScene;

it('registers show canvas scenes before rendering canvas effect ids', () => {
  const engine = voice.createVoiceBusEngine();
  engine.setModel(buildPixelModel(DEFAULT_KIT));
  engine.setShow({
    buses: [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 0 }],
    graphs: {},
    sections: [],
    effects: [{
      id: canvasEffectId(scene.id),
      name: scene.name,
      generatorId: canvasEffectId(scene.id),
      busId: 'base',
      scope: 'kit',
      params: [],
      attackMs: 0,
      sustainMs: 100,
      releaseMs: 0,
      playType: 'canvas',
      canvasScene: scene.id,
    }],
    presets: [],
    canvasScenes: [scene],
  });
  expect(tryGetCanvasScene(scene.id)?.name).toBe('Scene Test');
  expect(tryGetEffect(canvasEffectId(scene.id))?.name).toBe('Scene Test');
});

it('unregisters stale scene ids when a later show omits them', () => {
  const engine = voice.createVoiceBusEngine();
  engine.setModel(buildPixelModel(DEFAULT_KIT));
  engine.setShow({ buses: [], graphs: {}, sections: [], effects: [], presets: [], canvasScenes: [scene] });
  expect(tryGetCanvasScene(scene.id)).toBeTruthy();
  engine.setShow({ buses: [], graphs: {}, sections: [], effects: [], presets: [] });
  expect(tryGetCanvasScene(scene.id)).toBeUndefined();
});
```

Keep the tests deterministic and pure. Do not add server or DOM imports to core.

---

## 5. Web: add a canvas-scenes authored slice

### 5.1 New pure helper: `apps/web/src/lib/trigger-lab/store/canvas-scenes.ts`

Create this file. It keeps store logic thin and makes scene JSON behavior testable without Svelte.

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

export function canvasSceneOptions(scenes: readonly CanvasScene[]): { value: string; label: string }[] {
  return scenes.map((scene) => ({ value: scene.id, label: scene.name }));
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

export function sceneUsageCount(graphs: Record<string, TriggerGraph>, sceneId: string): number {
  let count = 0;
  for (const graph of Object.values(graphs)) {
    for (const node of graph.nodes) {
      if (node.kind !== 'play') continue;
      if (node.canvasScene === sceneId || canvasSceneIdOf(node.effectId) === sceneId) count += 1;
    }
  }
  return count;
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

This helper intentionally does not validate every element/lens numeric field. U5's JSON editor needs to prevent obvious corrupt shapes; the canvas renderer already has defensive numeric fallbacks. U6 can add a stricter zod schema if seed-scene authoring needs it.

### 5.2 `apps/web/src/lib/trigger-lab/persistence.ts`

Add the import:

```ts
import type { CanvasScene } from '@ledrums/core';
```

Extend `AuthoredState`:

```ts
export interface AuthoredState {
  graphs: Record<string, TriggerGraph>;
  graphNames: Record<string, string>;
  songs: Song[];
  songRefs?: string[];
  canvasScenes?: CanvasScene[];
  buses: Bus[];
  presets: Preset[];
  effects: EffectDef[];
  // existing fields...
}
```

In `coerceAuthored`, add this beside the other array fields:

```ts
if (Array.isArray(data.canvasScenes)) out.canvasScenes = data.canvasScenes as CanvasScene[];
```

No `VERSION` bump is needed. The persistence header explicitly says additive fields are tolerated without a version bump.

### 5.3 Seed authored state

Find `seedAuthored()` in `apps/web/src/lib/trigger-lab/store/seed.ts` or the current seed slice. Add `canvasScenes: []` to the returned authored state.

If there is no explicit seed field yet, the reset path is `store.svelte.ts:934-938` (`resetAuthoredToSeed()`) and `applyAuthored()` should default missing scene arrays to empty.

---

## 6. Store integration: scene docs, virtual effects, typed play nodes

### 6.1 `apps/web/src/lib/trigger-lab/store.svelte.ts` imports

Add imports:

```ts
import { canvasEffectId, type CanvasScene, type PlayType } from '@ledrums/core';
import * as canvasScenesLib from './store/canvas-scenes';
```

### 6.2 Add the authored rune

Near `effects` / `presets`:

```ts
/** User-authored Canvas scene documents (U5). Persisted in the show document. */
canvasScenes = $state<CanvasScene[]>([]);
```

### 6.3 Derived virtual canvas effects and presets

Add these getters. They keep canvas scenes visible to the existing effect/preset code without persisting synthetic effect definitions as real user effects.

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

Then update these existing lookups:

```ts
effectOf(node: GraphNode) {
  return node.kind === 'play' ? this.selectableEffects.find((e) => e.id === node.effectId) : undefined;
}

presetsForEffect(effectId: string): Preset[] {
  return this.allPresets.filter((p) => p.effectId === effectId);
}

presetById(id: string): Preset | undefined {
  return this.allPresets.find((p) => p.id === id);
}
```

Also update any internal calls that pass `this.effects` to graph helper functions for play-node initialization to use `this.selectableEffects` where canvas effects must be visible.

### 6.4 Authored persistence integration

In `toAuthored()` add:

```ts
canvasScenes: this.canvasScenes,
```

In `applyAuthored()` add:

```ts
this.canvasScenes = a.canvasScenes ?? [];
```

Do this even when absent, just like `songRefs`, so switching from a show with scenes to one without scenes clears the outgoing scenes.

### 6.5 Show source integration

Extend `ShowSource` in `apps/web/src/lib/trigger-lab/show-builder.ts`:

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

Return scenes in `buildShow()`:

```ts
return {
  buses: source.buses.map((b) => ({ ...b })),
  graphs: aliasResolvedGraphs(source.graphs),
  sections: source.sections.map((s) => ({ ...s, looks: { ...s.looks } })),
  effects: source.effects.map((e) => ({ ...e })),
  presets: source.presets.map((p) => ({ ...p })),
  canvasScenes: (source.canvasScenes ?? []).map((scene) => structuredClone(scene)),
  songs: // existing mapping...
};
```

Then update the store `showSource` getter:

```ts
private get showSource(): ShowSource {
  const rv = this.resolvedView;
  return {
    buses: this.buses,
    graphs: rv.graphs,
    sections: this.sections,
    effects: [...rv.effects, ...this.canvasEffects],
    presets: [...rv.presets, ...this.allPresets.filter((p) => p.effectId.startsWith('canvas:'))],
    canvasScenes: this.canvasScenes,
    drums: this.drums,
    songs: this.resolvedSongs,
  };
}
```

If `resolvedView` later owns canvas scenes via Song Library references, switch this to `rv.canvasScenes`. See ClipDoc / song-library section below.

### 6.6 Scene CRUD mutators

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
  if (this.isViewer) return;
  if (node.kind !== 'play') return;
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

### 6.7 Typed play-node creation

Add this store method:

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
    const eff = this.selectableEffects.find((e) => !e.deprecated && e.playType === playType) ?? this.selectableEffects.find((e) => !e.deprecated);
    if (!eff) return null;
    const preset = this.presetById(`${eff.id}:default`);
    node = makeNode('play', nid('n'), x, y, {
      ...graphsLib.playNodeInit([eff], (id) => this.presetById(id)),
      playType,
      effectId: eff.id,
      presetId: `${eff.id}:default`,
      params: { ...(preset?.params ?? defaultParams(eff)) },
    });
  }

  g.nodes.push(node);
  return node;
}
```

Keep `addNode('play', ...)` working for old callers, but route it to `addPlayNode('hits', ...)` or `addPlayNode('ambient', ...)` deliberately. Do not leave it seeding the first arbitrary effect forever.

### 6.8 `pickEffect` must enforce the node type

Modify `pickEffect` so the store is the authoritative guard, not just the gallery UI.

```ts
pickEffect(node: GraphNode, effectId: string): void {
  if (this.isViewer) return;
  if (node.kind !== 'play') return;
  const eff = this.selectableEffects.find((e) => e.id === effectId);
  if (!eff) return;
  const nodeType = node.playType ?? eff.playType ?? 'ambient';
  if (eff.playType !== nodeType) return;

  const pr = this.presetById(`${effectId}:default`);
  node.effectId = effectId;
  node.playType = nodeType;
  node.canvasScene = nodeType === 'canvas' ? node.canvasScene ?? effectId.slice('canvas:'.length) : undefined;
  node.scope = eff.scope;
  node.presetId = `${effectId}:default`;
  node.busId = '';
  node.params = { ...(pr?.params ?? defaultParams(eff)) };
  node.env = {};
}
```

For canvas effects, prefer calling `setCanvasScene(node, sceneId)` from the Inspector. The gallery can still call `pickEffect()` because virtual canvas effect ids are `canvas:<sceneId>`.

---

## 7. UI: typed palette, locked gallery, type chip

### 7.1 `apps/web/src/lib/app/views/TriggerGraphView.svelte`

Import the taxonomy:

```ts
import { COLLECTIONS, type PlayType } from '@ledrums/core';
```

Change `addGroups` so Play is its own group and `play` is removed from the generic Nodes group.

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
  // existing modulation and modifier groups...
]);
```

Update add dispatch:

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

### 7.2 `apps/web/src/lib/trigger-lab/EffectGallery.svelte`

The current gallery already has collection tabs, tag chips, param filter, search, and card anatomy. U5 should lock it to the node's play type when opened from a play node.

Add imports:

```ts
import { COLLECTIONS, collectionMeta, type PlayType } from '@ledrums/core';
```

Add derived lock:

```ts
const lockedPlayType = $derived<PlayType | null>(block?.kind === 'play' ? (block.playType ?? null) : null);
const lockedMeta = $derived(lockedPlayType ? collectionMeta(lockedPlayType) : null);
```

Update the open reset effect:

```ts
$effect(() => {
  if (block?.kind === 'play') {
    scope = block.scope === 'hoop' ? 'drum' : block.scope;
    collection = block.playType ?? 'all';
    activeTags = [];
    paramFilter = '';
    query = '';
  }
});
```

Use `store.selectableEffects` and filter by lock:

```ts
const pool = $derived(
  store.selectableEffects.filter((e) =>
    !e.deprecated &&
    e.scope === scope &&
    (!lockedPlayType || playTypeOf(e) === lockedPlayType)
  )
);
```

Tabs become a single locked tab when locked:

```ts
const collectionTabs = $derived(
  lockedPlayType
    ? [{ value: lockedPlayType, label: collectionMeta(lockedPlayType).label }]
    : [
        { value: 'all', label: 'All' },
        ...COLLECTIONS.filter((c) => pool.some((e) => playTypeOf(e) === c.type)).map((c) => ({ value: c.type, label: c.label })),
      ]
);
```

In the header/filter area show a locked chip:

```svelte
{#if lockedMeta}
  <Pill tone="accent" label={`Locked: ${lockedMeta.label}`} />
{/if}
```

The `pick()` handler can remain, because `store.pickEffect()` now rejects mismatched types.

### 7.3 `apps/web/src/lib/app/views/NodeCard.svelte`

Add an optional type-chip prop. This keeps Patch nodes unchanged.

```ts
type Props = {
  // existing props...
  typeChip?: string;
};
```

Render it in `.card-head` after the icon and before the title:

```svelte
{#if typeChip}<span class="typechip">{typeChip}</span>{/if}
```

Update the grid CSS minimally:

```css
.card-head {
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas:
    'icon chip'
    'icon title'
    'icon sub';
}
.card.has-thumb .card-head {
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'icon chip thumb'
    'icon title thumb'
    'icon sub thumb';
}
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

### 7.4 `apps/web/src/lib/app/views/TriggerNode.svelte`

Import `collectionMeta`:

```ts
import { collectionMeta } from '@ledrums/core';
```

Add derived chip:

```ts
const playTypeChip = $derived.by(() => {
  if (!node || node.kind !== 'play') return undefined;
  const type = node.playType ?? eff?.playType ?? 'ambient';
  return collectionMeta(type).label;
});
```

Pass it into NodeCard:

```svelte
<NodeCard
  icon={Icon}
  {title}
  {sub}
  tint={chipTint}
  selected={!!selected}
  typeChip={playTypeChip}
  thumb={kind === 'play' && eff ? playThumb : isSourceKind ? sourceThumb : isStateKind ? stateThumb : undefined}
  badge={linkHint ? drumLinkBadge : undefined}
  leadHandles={cardHandles}
  footer={modRows.length > 0 ? paramFooter : undefined}
/>
```

Keep `sub` as the preset label. The chip is the type, the title is the selected effect/scene, the sub is the preset. This preserves the existing node-face hierarchy.

---

## 8. Inspector: canvas scene picker + param editing

`PlayNodeInspector.svelte` already renders generic controls over `eff.params`. For canvas nodes, `eff` is the virtual EffectDef from `canvasEffectDef(scene)`, and its params come from `CANVAS_PARAM_SPEC` mapped through `fixtures.mapParamSpec()`. That means sliders for `brightness`, `speed`, `hue`, `canvasRotDeg`, `canvasOffsetX/Y`, `canvasScale`, and `samplerRotDeg` come for free.

Add a scene picker above the preset row.

```ts
const isCanvas = $derived((node.playType ?? eff?.playType) === 'canvas');
const sceneOptions = $derived(store.canvasScenes.map((scene) => ({ value: scene.id, label: scene.name })));
```

In markup, after the header and before preset bar:

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

CSS:

```css
.sceneRow {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-faint);
}
.sceneRow :global(.sceneSelect) {
  width: 100%;
  min-width: 0;
}
```

Change the header sub to show scene name for canvas nodes:

```svelte
<span class="sub">
  {#if isCanvas}{store.canvasScenes.find((s) => s.id === node.canvasScene)?.name ?? 'No scene'}{:else}{node.scope}{/if}
</span>
```

Do not special-case the params section. The existing generic param controls are exactly the point of D4.

---

## 9. Objects view: Canvas Scenes JSON authoring

### 9.1 `apps/web/src/lib/app/views/objects-view.ts`

Import type:

```ts
import type { CanvasScene } from '@ledrums/core';
```

Extend object types:

```ts
export type ObjectTypeId = 'songs' | 'library' | 'effects' | 'graphs' | 'presets' | 'canvas-scenes';
export const OBJECT_TYPE_IDS: readonly ObjectTypeId[] = ['songs', 'library', 'effects', 'graphs', 'presets', 'canvas-scenes'];
```

Add rows:

```ts
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

### 9.2 New component `apps/web/src/lib/app/views/CanvasSceneRow.svelte`

Model it after `PresetRow.svelte` / `GraphRow.svelte`: use `EditableRow`, `ContextMenu`, `IconButton`, and the same danger-delete confirmation pattern.

Core component skeleton:

```svelte
<script lang="ts">
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { CanvasSceneRow as Row } from './objects-view';
  import EditableRow from '../../ui/EditableRow.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Save from '@lucide/svelte/icons/save';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

  let { store, scene, active = false, onSelect }: { store: TriggerLab; scene: Row; active?: boolean; onSelect: () => void } = $props();

  let confirmDelete = $state(false);
  let draft = $state('');
  let error = $state<string | null>(null);

  $effect(() => {
    if (active) {
      draft = store.canvasSceneJson(scene.id);
      error = null;
    }
  });

  function saveJson(): void {
    const result = store.updateCanvasSceneJson(scene.id, draft);
    if (result.ok) error = null;
    else error = result.message;
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateCanvasScene(scene.id) },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => (confirmDelete = true) },
  ]);
</script>

<ContextMenu {actions} disabled={!store.canEdit}>
  <div class="sceneWrap" class:active onclick={onSelect} role="button" tabindex="0">
    <EditableRow
      label={scene.name}
      sub={`${scene.sampler} · ${scene.elementCount} elements · ${scene.lensCount} lenses`}
      active={active}
      onCommit={(name) => store.renameCanvasScene(scene.id, name)}
    />
    {#if active}
      <div class="editor" onclick={(e) => e.stopPropagation()}>
        <div class="editorBar">
          <span class="jsonLabel">Scene JSON</span>
          <span class="grow"></span>
          <IconButton icon={RotateCcw} label="Revert JSON" size={14} variant="soft" onclick={() => (draft = store.canvasSceneJson(scene.id))} />
          <IconButton icon={Save} label="Save JSON" size={14} variant="soft" onclick={saveJson} />
        </div>
        <textarea bind:value={draft} spellcheck="false" aria-label="Canvas scene JSON"></textarea>
        {#if error}<p class="err">{error}</p>{/if}
      </div>
    {/if}
  </div>
</ContextMenu>

<ConfirmDialog
  bind:open={confirmDelete}
  title="Delete canvas scene?"
  message={`Delete “${scene.name}”? Canvas nodes using it will be retargeted to another scene if one exists, otherwise cleared.`}
  confirmLabel="Delete"
  danger
  onConfirm={() => store.deleteCanvasScene(scene.id)}
/>

<style>
  .sceneWrap { border-radius: var(--radius-2); }
  .sceneWrap.active { background: var(--surface-2); }
  .editor {
    margin: 0 var(--space-2) var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    overflow: hidden;
  }
  .editorBar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .jsonLabel { font-size: var(--text-2xs); color: var(--text-muted); font-family: var(--font-mono); }
  .grow { flex: 1; }
  textarea {
    width: 100%;
    min-height: 260px;
    resize: vertical;
    padding: var(--space-3);
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
  }
  .err { margin: 0; padding: var(--space-2) var(--space-3); color: var(--live); font-size: var(--text-xs); }
</style>
```

### 9.3 `apps/web/src/lib/app/views/ObjectsView.svelte`

Imports:

```ts
import { canvasSceneRows, /* existing */ } from './objects-view';
import CanvasSceneRow from './CanvasSceneRow.svelte';
import Plus from '@lucide/svelte/icons/plus';
import Shapes from '@lucide/svelte/icons/shapes';
```

Derived row list:

```ts
const canvasScenes = $derived(canvasSceneRows(store.canvasScenes));
```

Types:

```ts
const TYPES: Array<{ id: ObjectTypeId; label: string; icon: Component }> = [
  { id: 'songs', label: 'Songs', icon: ListMusic },
  { id: 'library', label: 'Song Library', icon: LibraryBig },
  { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'graphs', label: 'Graphs', icon: Workflow },
  { id: 'presets', label: 'Presets', icon: Bookmark },
  { id: 'canvas-scenes', label: 'Canvas Scenes', icon: Shapes },
];
```

`countOf`:

```ts
const countOf = (id: ObjectTypeId): number =>
  id === 'songs'
    ? setlistCount
    : id === 'library'
      ? librarySongs.length
      : id === 'effects'
        ? effects.length
        : id === 'graphs'
          ? graphs.length
          : id === 'presets'
            ? presets.length
            : canvasScenes.length;
```

Header create button:

```svelte
{#if type === 'canvas-scenes' && store.canEdit}
  <IconButton icon={Plus} label="New canvas scene" size={14} onclick={() => (selectedId = store.createCanvasScene())} />
{/if}
```

Detail block:

```svelte
{:else if type === 'canvas-scenes'}
  {#each canvasScenes as scene (scene.id)}
    <CanvasSceneRow {store} scene={scene} active={selectedId === scene.id} onSelect={() => (selectedId = scene.id)} />
  {/each}
  {#if canvasScenes.length === 0}<p class="empty">No canvas scenes yet. Create one to author canvas-backed play nodes.</p>{/if}
{:else}
  <!-- existing presets block -->
{/if}
```

---

## 10. Clipboard and Song Library portability

U5 cannot leave canvas scenes stranded in a show-only field. A graph copied to another server must bring the scene documents it references, then remap scene ids exactly like graph/effect/preset ids.

### 10.1 `apps/web/src/lib/trigger-lab/clipdoc.ts`

Import CanvasScene and id helpers:

```ts
import { canvasEffectId, canvasSceneIdOf, type CanvasScene } from '@ledrums/core';
```

Extend deps:

```ts
export interface ClipDocDeps {
  graphs?: Record<string, TriggerGraph>;
  graphNames?: Record<string, string>;
  effects?: EffectDef[];
  presets?: Preset[];
  canvasScenes?: CanvasScene[];
}
```

Extend `ClosureSources` in `apps/web/src/lib/trigger-lab/store/song-library.ts` similarly. Every call site that builds a closure should pass `canvasScenes: this.canvasScenes`.

Add helpers to collect scene references:

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

Add `canvasScenes` into graph/section/song ClipDoc deps:

```ts
return {
  app: CLIPDOC_APP,
  v: CLIPDOC_VERSION,
  kind: 'graph',
  payload,
  deps: {
    effects: raw.effects,
    presets: raw.presets,
    canvasScenes: scenesForGraphs({ [key]: graph }, sources.canvasScenes),
  },
  meta: meta(over),
};
```

For section/song docs, pass the closure graphs map.

### 10.2 Remap materialization

Where `RemapResult` is defined, add:

```ts
canvasScenes: CanvasScene[];
```

During materialization:

1. Build `sceneIdMap` from incoming scene ids to fresh local ids.
2. Re-key each scene document.
3. Rewrite every play node referencing a scene.
4. Rewrite presets whose `effectId` is `canvas:<oldSceneId>`.

Core remap snippet:

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

When applying `RemapResult` in `TriggerLab.applyRemapResult`, merge scenes:

```ts
this.canvasScenes = [...this.canvasScenes, ...res.canvasScenes];
```

Also reserve scene ids in `remapResultIds()` so the id counter cannot reuse imported scene ids:

```ts
for (const scene of res.canvasScenes) yield scene.id;
```

### 10.3 Song Library closure

Any library-song closure (`store/song-library.ts`) must carry canvas scenes too. The same graph-scene-ref helper should be reused or duplicated as a pure function. When a library song is resolved into a show (`resolvedView`), include its `canvasScenes` in that resolved view so `showSource` can send all scenes the referenced graph keys need.

Minimum shape:

```ts
export interface ClosureSources {
  graphs: Record<string, TriggerGraph>;
  graphNames: Record<string, string>;
  effects: EffectDef[];
  presets: Preset[];
  canvasScenes?: CanvasScene[];
}

export interface LibrarySong {
  // existing fields...
  canvasScenes?: CanvasScene[];
}
```

If this is skipped, a song-library reference can resolve graphs containing `canvas:<id>` but the connected server will not receive the scene doc. That is a black-output bug.

---

## 11. Tests to add

### 11.1 Core

- `packages/core/src/voice/canvas-show.test.ts`
  - `setShow({ canvasScenes })` registers scene docs.
  - replacing with a show that omits a scene unregisters it.
  - a canvas play graph with a virtual EffectDef and `canvasScene` spawns a voice whose generator resolves through `canvas:<id>`.

### 11.2 Web pure tests

- `apps/web/src/lib/trigger-lab/store/canvas-scenes.test.ts`
  - `canvasEffectDef(scene)` produces `playType:'canvas'`, `generatorId:'canvas:<id>'`, `tags` containing `canvas`, and params matching `CANVAS_PARAM_SPEC` through `mapParamSpec`.
  - `parseCanvasSceneJson` accepts valid JSON, rejects changed id, rejects missing elements/sampler.
  - `retargetSceneRefs` retargets/c Clears canvas nodes after deletion.
- `apps/web/src/lib/trigger-lab/persistence.canvas-scenes.test.ts`
  - `serializeAuthored`/`coerceAuthored` round-trip `canvasScenes` without a version bump.
  - missing field loads as empty through store `applyAuthored` path.
- `apps/web/src/lib/trigger-lab/show-builder.canvas-scenes.test.ts`
  - `buildShow` includes `canvasScenes` and virtual canvas effects/presets from the store source.
  - graph node `canvasScene` survives structural assignment into `voice.Show`.
- `apps/web/src/lib/trigger-lab/clipdoc.canvas-scenes.test.ts`
  - copying a graph with a canvas node includes the scene doc.
  - paste remaps scene id and rewrites `node.canvasScene`, `node.effectId`, and canvas preset effect ids.
  - copying a song/section with canvas graphs includes scenes once, deduped.

### 11.3 Store tests

- `apps/web/src/lib/trigger-lab/store.canvas-scenes.test.ts`
  - `createCanvasScene` adds scene and persists through `toAuthored`/show library path.
  - `addPlayNode('canvas')` creates a scene if none exists, creates a node with `playType:'canvas'`, `canvasScene`, `effectId:'canvas:<id>'`, and canvas params.
  - `addPlayNode('particles')` picks only particle effects.
  - `pickEffect` rejects mismatched play types.
  - `setCanvasScene` updates effect id, preset id, params.
  - `deleteCanvasScene` retargets nodes to fallback or clears them when no fallback exists.

### 11.4 UI/component tests

Use existing component-test infrastructure if available from the componentisation pass.

- `apps/web/src/lib/app/views/objects-view.test.ts`
  - `canvasSceneRows` sorts by name/id and reports element/lens counts.
  - `ObjectTypeId` includes `canvas-scenes`.
- Add a small component test for `EffectGallery.svelte` if the harness supports it:
  - with `galleryBlock.playType = 'particles'`, cards only show particle effects.
  - collection tabs do not allow switching away from locked type.
- Add a component test for `PlayNodeInspector.svelte` if cheap:
  - canvas node renders the scene Select and the generic canvas param sliders.

---

## 12. UI-shot checklist

Run the app on the normal dev surfaces (`:4321` server, `:5173` Vite) and capture:

1. `u5-typed-play-palette` — Trigger view Add tab showing Play group with all seven types.
2. `u5-node-type-chip` — Trigger graph with a typed play node face showing the type chip.
3. `u5-gallery-locked` — Effect Gallery opened from a Particles or Canvas node, showing locked collection chip and no cross-type cards.
4. `u5-canvas-inspector` — Play Inspector for a Canvas node showing scene picker and canvas param sliders.
5. `u5-canvas-scenes-objects` — Objects view Canvas Scenes section with a selected row and JSON editor.

If `scripts/ui-shot/shots.json` still has the broken `effect-gallery` named shot noted in the U1–U4 report, use ad-hoc captures like U2/U3 did, but include the capture commands and output paths in the U5 handoff report.

---

## 13. Design-system updates

Because this is UI work, update and regenerate the design system.

Add or extend demos in `apps/web/src/lib/styleguide/` for:

- NodeCard with `typeChip`.
- AddPalette with a Play group.
- Canvas Scene row/editor, if it becomes a reusable component.

Then run:

```bash
pnpm design-system
```

Do not skip this. `AGENTS.md` makes design-system regeneration part of the UI contract.

---

## 14. Handoff report required by #58

Create `docs/reports/2026-07-05-elv2-u5-report.md` in the implementation commit.

Use this exact structure:

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

## 15. Status tracker update

In the same implementation commit(s), update `docs/plans/2026-07-05-effects-library-v2.md` status tracker row:

Current row:

```md
| U5 canvas UI | issued (external) | GH #58 | ... |
```

Change to:

```md
| U5 canvas UI | done | <commit shas> | Typed play palette; gallery locked to playType; node type chip; Canvas scene picker + params; Objects Canvas Scenes JSON editor; show-doc scene persistence + ClipDoc portability. Report: `docs/reports/2026-07-05-elv2-u5-report.md`. |
```

Do not mark U6 or U7 done.

---

## 16. Verification commands

Minimum gates:

```bash
pnpm typecheck
pnpm --filter '!@ledrums/desktop' -r test
pnpm design-system
pnpm ui-shot
```

If full `pnpm ui-shot` is blocked by the known `effect-gallery` named-shot timeout, run targeted/ad-hoc shots and record that explicitly in the U5 report. Do not present a green UI verification without screenshots.

---

## 17. Common failure modes to avoid

1. **Canvas scene registered only in the browser.** Offline preview works, connected engine renders black. Fix: `voice.Show.canvasScenes` + core `setShow()` registry sync.
2. **Virtual canvas EffectDef not sent in `show.effects`.** `VoicePool.spawn()` returns null before it can host `canvas:<sceneId>`. Fix: include `canvasEffectDef(scene)` in show source effects.
3. **EffectGallery only visually locked.** A stale callback can still pick a wrong type. Fix: `store.pickEffect()` rejects mismatched `playType`.
4. **Deleting a scene leaves dangling `canvasScene` refs.** Fix: retarget to fallback or clear canvas nodes; remove saved presets for the deleted `canvas:<id>` effect.
5. **ClipDoc copies graphs but not scenes.** Paste succeeds visually but canvas nodes render black on another server. Fix: scene deps + id remap.
6. **Persisting synthetic canvas effects as real effects.** This creates duplicate/renamed virtual effects and confusing Objects rows. Prefer derived `canvasEffects`; persist scene docs and user-saved presets only.
7. **JSON editor permits id edits.** Changing ids without rewriting graph refs breaks every canvas node. Reject id edits in U5; duplicate is the supported way to create a new id.
8. **Styleguide/design-system skipped.** This violates project process and makes later UI agents cheaper only in theory. Add demos and regenerate.

---

## 18. Suggested implementation PR summary

Use this after implementation:

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
