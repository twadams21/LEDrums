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

// Effects
export * from './effects/types';
export * from './effects/field';
export * from './effects/registry';

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
