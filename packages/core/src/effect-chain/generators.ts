/**
 * The Generator registry: a short list of Generators, each a facade over existing effect
 * implementations. A Generator has Styles; each Style dispatches to ONE existing effect
 * generator id (`effects/registry.ts`), optionally with fixed params the Style implies.
 *
 * Data-driven on purpose: S03 completes this table (all nine Generators plus Splice / Slice)
 * without touching the resolver. S01 ships only the tracer rows.
 */
import type { GeneratorDevice, GeneratorKind } from './types';

type StyleParams = Record<string, number | boolean | string>;

export interface GeneratorStyle {
  id: string;
  label: string;
  /** The existing effect generator id this Style renders through. */
  effectId: string;
  /** Params the Style fixes on top of the effect's defaults (authored params still win). */
  params?: StyleParams;
}

export interface GeneratorDef {
  id: GeneratorKind;
  label: string;
  /** First Style is the default for a device whose `style` is empty. */
  styles: GeneratorStyle[];
}

/** What a Generator device resolves to: the effect generator to host and its params. */
export interface ResolvedGenerator {
  effectId: string;
  params: StyleParams;
  /** Canvas-scene document id, for the Scene generator (S03). */
  canvasScene?: string;
}

const GENERATOR_TABLE: readonly GeneratorDef[] = [
  {
    id: 'solid',
    label: 'Solid',
    styles: [
      { id: 'solid', label: 'Solid', effectId: 'solid-colour' },
      { id: 'simple', label: 'Simple', effectId: 'whole-drum' },
    ],
  },
  {
    id: 'wave',
    label: 'Wave',
    styles: [
      { id: 'radial', label: 'Radial', effectId: 'radial-wash' },
      { id: 'chase', label: 'Chase', effectId: 'chase-bands' },
    ],
  },
];

const byId = new Map<string, GeneratorDef>(GENERATOR_TABLE.map((g) => [g.id, g]));

/** Every Generator with at least one Style, in display order. */
export function listGenerators(): readonly GeneratorDef[] {
  return GENERATOR_TABLE;
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
  const style = device.style ? def.styles.find((s) => s.id === device.style) : def.styles[0];
  if (!style) return null;
  return { effectId: style.effectId, params: { ...style.params, ...device.params } };
}
