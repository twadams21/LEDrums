// Shared transport/connection constants (referenced by server + web).
export const WS_PORT = 4321;
export const WS_PATH = '/ws';

export * from './math';

// Geometry
export * from './geometry/kit-schema';
export * from './geometry/kit-migrations';
export * from './geometry/kit-queries';
export * from './geometry/euler';
export * from './geometry/zones';
export * from './geometry/pixel-model';
export * from './geometry/dmx-map';

// Color
export * from './color/color';
export * from './color/blend';

// Model
export * from './model/project-schema';
export * from './model/integrity';
export * from './model/routing-integrity';
export * from './model/chain-wiring';
export * from './model/defaults';

// Canvas (D4) — scene documents sampled through kit geometry; hosted through the ONE
// EffectGenerator seam via `canvas:<sceneId>` adapter ids (no compositor fork).
export * from './canvas/ids';
export * from './canvas/sampler';
export * from './canvas/types';
export * from './canvas/elements';
export * from './canvas/lenses';
export * from './canvas/scene';
export * from './canvas/registry';
export * from './canvas/presets';

// Effects
export * from './effects/types';
export * from './effects/emitter';
export * from './effects/registry';
export * from './effects/vocabulary';
export * from './effects/metadata';
export * from './effects/aliases';

// Modifiers (media-effects layer — pure framebuffer transforms applied between a
// voice's render and the compositor blend). The chain runner is the compositor's seam.
export {
  type ModifierDef,
  type ModifierContext,
  type ModifierCategory,
  type PixelRange,
  type ResolvedModifier,
} from './modifiers/types';
export { getModifier, tryGetModifier, listModifiers, modifierIds } from './modifiers/registry';
export { applyModifierChain } from './modifiers/chain';
export {
  type ModifierCategoryGroup,
  MODIFIER_CATEGORY_ORDER,
  MODIFIER_CATEGORY_LABEL,
  listModifiersByCategory,
} from './modifiers/palette';

// Render primitives, in `render/` — INIT-01 S15 renamed the directory once S13 left no engine
// in it (control-state, modulation, compositor, engine all deleted). What survives is what the
// LIVE stack uses:
// framebuffer + render-context have 30+ import sites across effects/, modifiers/, canvas/ and
// voice/; transport.ts is called every frame by the voice loop (advanceTransport); stats.ts holds
// the `stats` wire type the deleted engine happened to declare.
export * from './render/framebuffer';
export * from './render/render-context';
export * from './render/transport';
export * from './render/stats';

// Voice-bus brain. The namespace was introduced to avoid name clashes with the legacy Engine's
// InputEvent/EngineStats during the migration; S13 deleted that engine, and the namespace stays
// because `voice.` is a load-bearing seam marker at 40+ call sites, not migration scaffolding.
export * as voice from './voice';
