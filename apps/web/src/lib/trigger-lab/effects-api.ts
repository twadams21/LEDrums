/**
 * The Effect-chain authoring contract between the web store and the Effects view UI.
 *
 * `TriggerLab` (store.svelte.ts) implements {@link EffectsAuthoringApi}; the grid, device strip,
 * sections / objects views and MIDI-map UI depend ONLY on this interface, so they can be built
 * and demoed (styleguide fixtures) independently of the store. Every mutator is a guarded,
 * undoable authoring edit (one undo step; drags fold between `beginGesture` / `endGesture`), a
 * no-op for viewers / read-only (canonical library) songs, and autosaves like every other edit.
 *
 * Ids: Effects are addressed by `Effect.id` (unique within a section); devices inside an Effect
 * by `ModifierDevice.uid` / `ControlDevice.uid`. A cell is `{ row: 'kit' | drumId, column }`.
 */
import type { effectChain } from '@ledrums/core';

type Effect = effectChain.Effect;
type EffectCell = effectChain.EffectCell;
type EffectColumn = effectChain.EffectColumn;
type EffectTarget = effectChain.EffectTarget;
type EffectTrigger = effectChain.EffectTrigger;
type AmpEnvelope = effectChain.AmpEnvelope;
type GeneratorKind = effectChain.GeneratorKind;
type ModifierDevice = effectChain.ModifierDevice;
type ModifierEnvelopeSpec = effectChain.ModifierEnvelopeSpec;
type ControlDevice = effectChain.ControlDevice;
type ControlKind = effectChain.ControlKind;
type ControlMapping = effectChain.ControlMapping;
type Retrigger = effectChain.Retrigger;
type SpliceSlot = effectChain.SpliceSlot;
type BlendMode = Effect['blend'];
type ParamValue = number | boolean | string;

/** The Master cell: the section's master modifier chain, shown at the Kit row's start. */
export const MASTER_CELL = 'master' as const;
export type CellSelection = EffectCell | typeof MASTER_CELL;

/** One grid row: the Kit, or a drum in kit order. */
export interface GridRow {
  /** `'kit'` or the drum id. */
  id: string;
  label: string;
  /** Drum colour (hex) for the row chip; absent for the Kit row. */
  color?: string;
}

/** One grid column, in display order: the union of zone slots across drums, then Always / Clock / Cue. */
export interface GridColumn {
  column: EffectColumn;
  /** Header label ("Head", "Zone 2", "Always", …). */
  label: string;
}

/** What a grid cell shows without reading its Effects. */
export interface CellSummary {
  /** False for cells that cannot hold Effects (a zone the drum doesn't have; zones on the Kit row). */
  enabled: boolean;
  count: number;
  /** First Effect's name + generator kind, for the cell face. */
  firstName?: string;
  firstGenerator?: GeneratorKind;
  /** Every Effect in the cell is bypassed. */
  allBypassed: boolean;
  /** Human zone label for zone columns ("Head center"), else the column label. */
  label: string;
}

/** Why a file load / paste did or didn't apply (mirrors the existing graph-file results). */
export type ApplyResult = { ok: true } | { ok: false; reason: string };

export interface EffectsAuthoringApi {
  // ---- read models (reactive in the store) --------------------------------------------------
  readonly canEdit: boolean;
  readonly activeSectionId: string | null;
  readonly gridRows: readonly GridRow[];
  readonly gridColumns: readonly GridColumn[];
  cellSummary(cell: EffectCell): CellSummary;
  /** The cell's stack, in stack (composition) order. */
  cellEffects(cell: EffectCell): readonly Effect[];
  readonly masterChain: readonly ModifierDevice[];
  readonly selectedCell: CellSelection | null;
  readonly selectedEffectId: string | null;
  effectById(effectId: string): Effect | undefined;
  /** Engine time (ms, `performance.now()` base) the cell / Effect last fired — for fire flashes. */
  cellFireAt(cell: EffectCell): number;
  effectFireAt(effectId: string): number;

  // ---- selection + audition ------------------------------------------------------------------
  selectCell(cell: CellSelection | null): void;
  selectEffect(effectId: string | null): void;
  fireEffect(effectId: string): void;
  /** Audition the section's nth Effect in grid order (keys 1–9, 0). */
  fireEffectAt(index: number): void;
  fireCell(cell: EffectCell): void;

  // ---- Effects ---------------------------------------------------------------------------------
  /** Adds an Effect to the cell (default target from the row), selects it, returns its id. */
  addEffect(cell: EffectCell, generator: GeneratorKind, style?: string): string | null;
  removeEffect(effectId: string): void;
  duplicateEffect(effectId: string): string | null;
  /** Move within / between cells; `index` is the position in the destination stack. */
  moveEffect(effectId: string, to: EffectCell, index: number): void;
  renameEffect(effectId: string, name: string): void;
  setEffectBypass(effectId: string, bypass: boolean): void;
  setEffectBlend(effectId: string, blend: BlendMode): void;
  setEffectOpacity(effectId: string, opacity: number): void;
  setRetrigger(effectId: string, retrigger: Retrigger): void;
  setAmp(effectId: string, amp: Partial<AmpEnvelope>): void;
  /** Change trigger kind (moves the Effect to the matching column of its row) or its settings. */
  setTrigger(effectId: string, trigger: EffectTrigger): void;
  setTarget(effectId: string, target: EffectTarget): void;

  // ---- Generator -------------------------------------------------------------------------------
  /** Swap the Generator (kind / Style); keeps modifiers, controls, target. */
  setGenerator(effectId: string, kind: GeneratorKind, style?: string): void;
  setGeneratorParam(effectId: string, key: string, value: ParamValue): void;
  /** Several Generator params as one undo step; `undefined` removes a param. */
  setGeneratorParams(effectId: string, patch: Readonly<Record<string, ParamValue | undefined>>): void;
  setSpliceSlots(effectId: string, slots: SpliceSlot[]): void;

  // ---- Modifiers (effectId = MASTER_CELL addresses the section master chain) --------------------
  addModifier(effectId: string | typeof MASTER_CELL, modifierId: string, index?: number): string | null;
  removeModifier(effectId: string | typeof MASTER_CELL, uid: string): void;
  moveModifier(effectId: string | typeof MASTER_CELL, uid: string, index: number): void;
  setModifierParam(effectId: string | typeof MASTER_CELL, uid: string, key: string, value: ParamValue): void;
  /** Several params of one modifier as one undo step; `undefined` removes a param. */
  setModifierParams(effectId: string | typeof MASTER_CELL, uid: string, patch: Readonly<Record<string, ParamValue | undefined>>): void;
  setModifierMix(effectId: string | typeof MASTER_CELL, uid: string, mix: number): void;
  setModifierEnvelope(effectId: string | typeof MASTER_CELL, uid: string, envelope: ModifierEnvelopeSpec | null): void;
  setModifierBypass(effectId: string | typeof MASTER_CELL, uid: string, bypass: boolean): void;

  // ---- Controls --------------------------------------------------------------------------------
  addControl(effectId: string, kind: ControlKind): string | null;
  removeControl(effectId: string, uid: string): void;
  setControlSettings(effectId: string, uid: string, settings: Partial<ControlDevice['settings']>): void;
  addMapping(effectId: string, controlUid: string, mapping: ControlMapping): void;
  setMapping(effectId: string, controlUid: string, index: number, mapping: Partial<ControlMapping>): void;
  removeMapping(effectId: string, controlUid: string, index: number): void;

  // ---- Cells -----------------------------------------------------------------------------------
  copyCell(cell: EffectCell): void;
  /** Paste the clipboard stack into the cell (fresh ids; appended to the stack). */
  pasteCell(cell: EffectCell): ApplyResult;
  readonly canPasteCell: boolean;
  clearCell(cell: EffectCell): void;

  // ---- Cue learn (MIDI / OSC) --------------------------------------------------------------------
  startCueLearn(effectId: string, via: 'midi' | 'osc'): void;
  cancelCueLearn(): void;
  readonly cueLearnEffectId: string | null;

  // ---- Files (Tim's save/load-to-file, extended) --------------------------------------------------
  saveEffectToFile(effectId: string): Promise<void>;
  saveCellToFile(cell: EffectCell): Promise<void>;
  saveDeviceToFile(effectId: string, device: 'generator' | string): Promise<void>;
  loadFileIntoCell(cell: EffectCell): Promise<ApplyResult>;
  loadFileIntoEffect(effectId: string): Promise<ApplyResult>;

  // ---- Undo bracketing for drags -----------------------------------------------------------------
  beginGesture(): void;
  endGesture(): void;

  // ---- Import (S06c UI) -----------------------------------------------------------------------------
  readonly legacyImportAvailable: boolean;
  /** Names of the old-format shows an import would bring across. */
  readonly legacyShowNames: readonly string[];
  importLegacyShows(): ApplyResult;
  dismissLegacyImport(): void;
}
