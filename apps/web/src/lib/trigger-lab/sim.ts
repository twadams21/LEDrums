/* =============================================================================
   TRIGGER LAB — the AUTHORING MODEL. Types and pure helpers, no runtime.

   This is what the editor authors against: the effect/preset/bus/section shapes,
   the trigger-graph node model (`GraphNode` / `TriggerGraph` / `makeNode`), the
   Block tree and its graph compilation, envelopes and param primitives, and
   trigger-source matching. ~110 modules import from here — every Inspector, the
   graph views, persistence, clipdoc, the show builder and the store slices.

   An effect (e.g. Swirl) has parameters + named presets; a placed clip is an
   INSTANCE of effect+preset that owns its params — a preset is a snapshot you
   Apply onto a clip or Save from it, never a live binding. Params can be driven by
   envelopes over a voice's life.

   WHAT USED TO BE HERE: a `Sim` class (voice lifecycle + a local render mirror)
   that previewed authored content in the browser while the engine link was down.
   INIT-01 Decision 3 retired it — the ENGINE is the single renderer, and the
   preview surfaces show a disconnected state instead of simulating. Graph
   evaluation was never duplicated: `Sim` delegated to core's `voice.evalGraph`,
   which the surviving suites now call directly (test-support/graph-eval).

   The file name is a leftover from that era; renaming it is a ~110-importer
   mechanical change, tracked as its own follow-on.

   STRUCTURE (S3.3 split): the cohesive sub-concerns live alongside and are
   re-exported below so the public `./sim` surface is unchanged:
     - `./sim.envelopes`         — ADSR shapes/sampling + param primitives.
     - `./sim.trigger-source`    — TriggerSource matching + value normalization.
     - `./sim.graph-compilation` — trigger-graph types, block→graph, velocity fold.
   ============================================================================= */

import { voice, type BlendMode, type EffectCategory, type EffectTag, type PlayType, type ResolvedModifier } from '@ledrums/core';
import { type EnvMap, type Mapping, type ParamSpec, type ParamValues } from './sim.envelopes';
import { type TriggerGraph } from './sim.graph-compilation';

// Re-export the extracted modules so the public `./sim` API is unchanged.
// `clampUnit` is intentionally NOT re-exported here — it stays an internal cross-module
// helper, preserving the prior public surface byte-for-byte.
export {
  type ParamValue,
  type ParamValues,
  type EnvMap,
  type ParamSpec,
  type EnvKind,
  type EnvPoint,
  type Envelope,
  defaultEnvelope,
  cloneEnvelope,
  type AdsrShape,
  type EaseFn,
  type EaseDir,
  type EaseSpec,
  defaultAdsr,
  adsrToPoints,
  migrateAdsr,
  type Mapping,
  type ModSource,
} from './sim.envelopes';
export * from './sim.trigger-source';
export * from './sim.graph-compilation';

// ---- Block tree (branch 2) --------------------------------------------------

export type PlayMode = 'oneshot' | 'loop' | 'hold';
/** What a switch routes on. `value` (gate/bands) is the canonical intensity-routing
    mode; the older `velocity` mode was a near-duplicate (even count split on the same
    normalized intensity) and was folded into `value` and removed — see
    {@link foldVelocitySwitch}. `section`/`beat` are count-based and unchanged.
    CANONICAL in core `voice/types.ts` — re-exported here as a type alias (S4.4). */
export type SwitchOn = voice.SwitchOn;
/** Sub-mode of a `value` switch: a single pass/block gate, or N value bands.
    CANONICAL in core `voice/types.ts` — re-exported here as a type alias (S4.4). */
export type ValueMode = voice.ValueMode;
export type Scope = 'drum' | 'kit' | 'hoop';
export type BlockKind = Block['kind'];

interface BlockBase {
  id: string;
}

/** Leaf: an instance of an effect+preset. Every play block owns its params; a preset is
    a snapshot you Apply onto a block or Save from it, never a live binding. */
export interface PlayBlock extends BlockBase {
  kind: 'play';
  mode: PlayMode;
  scope: Scope;
  effectId: string;
  presetId: string;
  /** node-local param values (a preset Apply forks a copy in here). */
  params: ParamValues;
  /** per-param envelope assignment. */
  env: EnvMap;
}
export interface AllBlock extends BlockBase {
  kind: 'all';
  children: Block[];
}
export interface RandomBlock extends BlockBase {
  kind: 'random';
  children: Block[];
  noRepeat: boolean;
}
export interface SequenceBlock extends BlockBase {
  kind: 'sequence';
  children: Block[];
}
export interface SwitchBlock extends BlockBase {
  kind: 'switch';
  on: SwitchOn;
  /** value-switch sub-mode (only meaningful when `on === 'value'`). Optional so a
      block authored before value-mode omits it; {@link treeToGraph} carries it onto
      the graph node and, for `'bands'`, gives each child edge its `band-${i}` handle. */
  valueMode?: ValueMode;
  /** ascending band cutoffs for a `value`+`bands` switch (see {@link GraphNode.bands}). */
  bands?: number[];
  children: Block[];
}
export interface ChanceBlock extends BlockBase {
  kind: 'chance';
  p: number;
  child: Block;
}
export interface ToggleBlock extends BlockBase {
  kind: 'toggle';
  child: Block;
}

export type Block =
  | PlayBlock
  | AllBlock
  | RandomBlock
  | SequenceBlock
  | SwitchBlock
  | ChanceBlock
  | ToggleBlock;

// ---- Effects + presets + buses (branch 1) -----------------------------------

export type Polyphony = 'mono' | 'poly';

export interface EffectDef {
  id: string;
  name: string;
  /**
   * The effect is GENERATOR-BACKED: a voice hosting it delegates rendering to the core
   * {@link EffectGenerator} registered under this id. The server voice path renders it for
   * real output; the offline preview (render.ts) delegates to the SAME core generator.
   * Every selectable effect is generator-backed since the legacy per-pixel pattern path was
   * retired (Effects Library v2, U3).
   */
  generatorId?: string;
  /** Legacy effect category (base/trigger/wash/meter/texture/particle/utility) —
      surfaced so the gallery can group/filter generator effects. */
  category?: EffectCategory;
  /** Gallery card / inspector blurb (from core `metadata.ts`, via the generator seam). */
  description?: string;
  /** Controlled-vocabulary tags — the gallery filters on these (D1). */
  tags?: readonly EffectTag[];
  /** User-facing collection derived from tags (first-match) — the gallery's primary rail
      and the taxonomy the typed play nodes (D3) will share. */
  playType?: PlayType;
  /** When set, the effect is retired: never listed in the gallery (aliases keep shows working). */
  deprecated?: { replacedBy: string; note?: string };
  busId: string;
  scope: Scope;
  params: ParamSpec[];
  attackMs: number;
  /** one-shot dwell at full before release. */
  sustainMs: number;
  releaseMs: number;
}

export interface Preset {
  id: string;
  name: string;
  effectId: string;
  params: ParamValues;
}

export interface Bus {
  id: string;
  name: string;
  polyphony: Polyphony;
  crossfadeMs: number;
}

// ---- Section snapshots (branch 3) -------------------------------------------

export interface Section {
  id: string;
  name: string;
  /** which effect each bus loops when the section loads (null = silent). */
  looks: Record<string, string | null>;
}

// ---- Evaluation context -----------------------------------------------------

/** Trigger context — CANONICAL in core `voice/eval-graph.ts` (there `TriggerCtx`,
    re-exported from `@ledrums/core` as `EvalTriggerCtx`). Aliased here so web
    importers keep the `TriggerCtx` name on the `./sim` surface. */
export type TriggerCtx = voice.EvalTriggerCtx;

/** Resolve a param spec list to its default values. */
export function defaultParams(effect: EffectDef): ParamValues {
  const out: ParamValues = {};
  for (const s of effect.params) out[s.key] = s.default;
  return out;
}
