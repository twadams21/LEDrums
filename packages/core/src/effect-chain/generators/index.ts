/**
 * The Generator registry: a short list of Generators, each a facade over existing effect
 * implementations. A Generator has Styles; each Style dispatches to ONE existing effect
 * generator id (`effects/registry.ts`), optionally with fixed params the Style implies.
 * Splice / Slice / Scene resolve through their def's own `resolve`.
 *
 * Data-driven: each kind lives in its own file so kinds are authored independently; this module
 * only aggregates them and never needs editing to add a Style.
 */
import { tryGetEffect } from '../../effects/registry';
import type { ParamSpec } from '../../effects/types';
import type { GeneratorDevice } from '../types';
import { dotGenerator } from './dot';
import { gradientGenerator } from './gradient';
import { lightningGenerator } from './lightning';
import { meterGenerator } from './meter';
import { noiseGenerator } from './noise';
import { particlesGenerator } from './particles';
import { patternGenerator } from './pattern';
import { sceneGenerator } from './scene';
import { sliceGenerator } from './slice';
import { solidGenerator } from './solid';
import { spliceGenerator } from './splice';
import type { GeneratorDef, ResolvedGenerator } from './types';
import { waveGenerator } from './wave';

export type { GeneratorDef, GeneratorStyle, ResolvedGenerator, StyleParams } from './types';

/** Display order of the Generator picker. */
const GENERATOR_TABLE: readonly GeneratorDef[] = [
  solidGenerator,
  gradientGenerator,
  waveGenerator,
  noiseGenerator,
  particlesGenerator,
  dotGenerator,
  patternGenerator,
  meterGenerator,
  lightningGenerator,
  sceneGenerator,
  spliceGenerator,
  sliceGenerator,
];

const byId = new Map<string, GeneratorDef>(GENERATOR_TABLE.map((g) => [g.id, g]));

/** Every Generator that can resolve (at least one Style, or a custom resolver), in display order. */
export function listGenerators(): readonly GeneratorDef[] {
  return GENERATOR_TABLE.filter((g) => g.styles.length > 0 || g.resolve);
}

export function getGeneratorDef(kind: string): GeneratorDef | undefined {
  return byId.get(kind);
}

/**
 * Resolve a Generator device to the effect it hosts, or `null` for an unknown kind or Style
 * (the caller skips the Effect with a diagnostic — never a throw). An empty `style` picks the
 * Generator's first Style. Params layer: Style-fixed params, then the device's own.
 */
export function resolveGenerator(device: GeneratorDevice): ResolvedGenerator | null {
  const def = byId.get(device.kind);
  if (!def) return null;
  if (def.resolve) return def.resolve(device);
  const style = device.style ? def.styles.find((s) => s.id === device.style) : def.styles[0];
  if (!style) return null;
  return { effectId: style.effectId, params: { ...style.params, ...device.params } };
}

/**
 * The params a Generator card shows for a Style: the hosted effect's param spec minus the
 * Style's fixed and hidden params, with the Style's label overrides applied. Empty for an
 * unknown kind / Style or a custom-resolving Generator (those supply their own card params).
 */
export function generatorParamSpec(kind: string, styleId: string): ParamSpec[] {
  const def = byId.get(kind);
  if (!def) return [];
  const style = styleId ? def.styles.find((s) => s.id === styleId) : def.styles[0];
  if (!style) return [];
  const hosted = tryGetEffect(style.effectId);
  if (!hosted) return [];
  const fixed = new Set([...Object.keys(style.params ?? {}), ...(style.hiddenParams ?? [])]);
  return hosted.paramSpec
    .filter((p) => !fixed.has(p.key))
    .map((p) => (style.paramLabels?.[p.key] ? { ...p, label: style.paramLabels[p.key]! } : p));
}
