// Shared transport/connection constants (referenced by server + web).
export const WS_PORT = 4321;
export const WS_PATH = '/ws';

export * from './math';

// Geometry
export * from './geometry/kit-schema';
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

// Engine
export * from './engine/framebuffer';
export * from './engine/render-context';
export * from './engine/control-state';
export * from './engine/transport';
export * from './engine/modulation';
export * from './engine/compositor';
export * from './engine/engine';

// Voice-bus brain (additive, behind a deep-module seam). Namespaced to avoid
// name clashes with the legacy Engine's InputEvent/EngineStats during migration.
export * as voice from './voice';
