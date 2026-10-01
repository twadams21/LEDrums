/**
 * Generator registry types. One `GeneratorDef` per Generator kind lives in its own file under
 * `generators/` (so kinds can be authored independently); `generators/index.ts` aggregates them.
 */
import type { MixInputDraft } from '../../voice/eval-graph';
import type { SpliceConfig } from '../../voice/types';
import type { GeneratorDevice, GeneratorKind } from '../types';

export type StyleParams = Record<string, number | boolean | string>;

export interface GeneratorStyle {
  id: string;
  label: string;
  /** The existing effect generator id this Style renders through. */
  effectId: string;
  /** Params the Style fixes on top of the effect's defaults (authored params still win). */
  params?: StyleParams;
  /** Underlying params the card should not show for this Style. */
  hiddenParams?: readonly string[];
  /** Display-label overrides for underlying params, keyed by param key. */
  paramLabels?: Readonly<Record<string, string>>;
}

export interface GeneratorDef {
  id: GeneratorKind;
  label: string;
  /** One-line card / picker description. */
  description?: string;
  /** Lucide icon name the UI uses for this Generator. */
  icon?: string;
  /** First Style is the default for a device whose `style` is empty. */
  styles: GeneratorStyle[];
  /** Custom resolution (Splice / Slice / Scene); when present it replaces Style lookup. */
  resolve?: (device: GeneratorDevice) => ResolvedGenerator | null;
}

/** What a Generator device resolves to: the effect generator to host and its params. */
export interface ResolvedGenerator {
  effectId: string;
  params: StyleParams;
  /** Canvas-scene document id, for the Scene generator. */
  canvasScene?: string;
  /** Splice / Slice layout; carried verbatim onto the play action. */
  splice?: SpliceConfig;
  /** One draft per non-blank splice slot, index-aligned with `splice.inputBySlot`. */
  spliceInputs?: MixInputDraft[];
}
