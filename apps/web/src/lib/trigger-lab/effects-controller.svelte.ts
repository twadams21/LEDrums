/** Effects authoring controller (effect chains, S05 §2) — implements {@link EffectsAuthoringApi}
    over an injected {@link EffectsControllerHost}, the way {@link
    import('./sections-controller.svelte').SectionsController} implements section arrangement over
    its host.

    - Every mutator runs one PURE op from `effects-doc.ts` against the host's active section. A
      no-op op (same value back) records nothing; a real edit records ONE undo checkpoint through
      the host, then writes the section back (the host autosaves / resyncs). Drags fold into one
      checkpoint between {@link beginGesture} / {@link endGesture}, which the host owns.
    - `canEdit` false (viewer, read-only library song, no active section) makes every mutator a
      no-op. Audition (fire) and selection are not authoring and stay available.
    - Selection, the cell clipboard and the read models live here as runes; the section, kit,
      input map, fire times, files, cue learn and legacy import are the host's.

    {@link createStandaloneEffectsApi} is an in-memory host for styleguide demos + component tests. */

import { effectChain, inputMapSchema, type InputMap, type KitConfig } from '@ledrums/core';
import {
  MASTER_CELL,
  type ApplyResult,
  type CellSelection,
  type CellSummary,
  type EffectsAuthoringApi,
  type GridColumn,
  type GridRow,
} from './effects-api';
import * as doc from './effects-doc';
import type { ChainOwner, EffectsSection } from './effects-doc';
import { auditionSlots, cellEnabled, cellSummary, gridColumns, gridRows, zoneSlotsForDrum } from './grid-model';

type Effect = effectChain.Effect;
type EffectCell = effectChain.EffectCell;
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

const READ_ONLY: ApplyResult = { ok: false, reason: 'This section is read-only.' };

/** The store-side surface the controller depends on. Reads are reactive in the store. */
export interface EffectsControllerHost {
  /** The active section being authored (null = none). */
  getSection(): EffectsSection | null;
  /** Write the edited active section back (the only mutation surface). */
  setSection(next: EffectsSection): void;
  activeSectionId(): string | null;
  /** False for viewers, read-only (canonical library) songs, or no active section. */
  canEdit(): boolean;
  kit(): KitConfig;
  inputMap(): InputMap;
  undo: {
    /** Record one authored checkpoint before a mutation (folds while a gesture is open). */
    push(): void;
    beginGesture(): void;
    endGesture(): void;
  };
  fire: {
    effect(effectId: string): void;
    cell(cell: EffectCell): void;
    effectFireAt(effectId: string): number;
    cellFireAt(cell: EffectCell): number;
    /** Play a zone cell as a real hit on its drum zone, through the engine — so a Sequence /
        Random cell steps exactly as the drum would step it. False when the host can't (no pad
        for that zone, or no engine): the caller then auditions a step itself. */
    hit?(cell: EffectCell): boolean;
  };
  files: {
    saveEffect(effect: Effect): Promise<void>;
    saveCell(cell: EffectCell, stack: readonly Effect[]): Promise<void>;
    saveDevice(effect: Effect, device: 'generator' | string): Promise<void>;
    loadIntoCell(cell: EffectCell): Promise<ApplyResult>;
    loadIntoEffect(effectId: string): Promise<ApplyResult>;
  };
  learn: {
    start(effectId: string, via: 'midi' | 'osc'): void;
    cancel(): void;
    effectId(): string | null;
    /** Arm Learn for a cell's reset (the next note / CC / OSC address binds it). */
    startReset(cell: EffectCell, via: 'midi' | 'osc'): void;
    resetCell(): EffectCell | null;
  };
  legacyImport: {
    available(): boolean;
    showNames(): readonly string[];
    run(): ApplyResult;
    dismiss(): void;
  };
}

export class EffectsController implements EffectsAuthoringApi {
  #selectedCell = $state<CellSelection | null>(null);
  #selectedEffectId = $state<string | null>(null);
  /** Cell copy scratch (a deep-copied stack). Transient, never persisted. */
  #clipboard = $state<Effect[] | null>(null);

  constructor(private readonly host: EffectsControllerHost) {}

  // ---- read models -----------------------------------------------------------------------

  get canEdit(): boolean {
    return this.host.canEdit() && this.host.getSection() !== null;
  }
  get activeSectionId(): string | null {
    return this.host.activeSectionId();
  }
  #rows = $derived.by((): GridRow[] => gridRows(this.host.kit()));
  #columns = $derived.by((): GridColumn[] => gridColumns(this.host.kit(), this.host.inputMap()));
  get gridRows(): readonly GridRow[] {
    return this.#rows;
  }
  get gridColumns(): readonly GridColumn[] {
    return this.#columns;
  }
  cellSummary(cell: EffectCell): CellSummary {
    return cellSummary(this.host.getSection(), cell, this.host.kit(), this.host.inputMap());
  }
  cellEffects(cell: EffectCell): readonly Effect[] {
    const section = this.host.getSection();
    return section ? doc.cellEffects(section, cell) : [];
  }
  get masterChain(): readonly ModifierDevice[] {
    return this.host.getSection()?.master ?? [];
  }
  get selectedCell(): CellSelection | null {
    return this.#selectedCell;
  }
  get selectedEffectId(): string | null {
    // A selection whose Effect left the section (undo, delete, section switch) reads as none.
    const id = this.#selectedEffectId;
    return id !== null && this.effectById(id) ? id : null;
  }
  effectById(effectId: string): Effect | undefined {
    const section = this.host.getSection();
    return section ? doc.effectById(section, effectId) : undefined;
  }
  cellFireAt(cell: EffectCell): number {
    return this.host.fire.cellFireAt(cell);
  }
  effectFireAt(effectId: string): number {
    return this.host.fire.effectFireAt(effectId);
  }

  // ---- selection + audition --------------------------------------------------------------

  /** Selecting a cell selects its stack's first Effect (none for Master / an empty cell). */
  selectCell(cell: CellSelection | null): void {
    this.#selectedCell = cell === null || cell === MASTER_CELL ? cell : doc.cloneJson(cell);
    this.#selectedEffectId = cell === null || cell === MASTER_CELL ? null : (this.cellEffects(cell)[0]?.id ?? null);
  }
  /** Selecting an Effect also selects its cell. */
  selectEffect(effectId: string | null): void {
    const effect = effectId === null ? undefined : this.effectById(effectId);
    this.#selectedEffectId = effect ? effect.id : null;
    if (effect) this.#selectedCell = doc.cloneJson(effect.cell);
  }
  fireEffect(effectId: string): void {
    if (this.effectById(effectId)) this.host.fire.effect(effectId);
  }
  fireEffectAt(index: number): void {
    const slot = auditionSlots(this.host.getSection(), this.gridRows, this.gridColumns)[index];
    if (slot?.kind === 'effect') this.host.fire.effect(slot.effect.id);
    else if (slot) this.fireCell(slot.cell);
  }
  fireCell(cell: EffectCell): void {
    const play = this.cellPlay(cell);
    if (play && play.mode !== 'layer') {
      // A zone cell plays as a hit on its zone, so the engine's own step advances: the key, the
      // grid and the drum all walk ONE sequence.
      if (cell.column.kind === 'zone' && this.host.fire.hit?.(cell)) return;
      // Auditioning a Sequence / Random cell plays ONE step, like a hit would: the step after the
      // last one played (so repeated auditions walk the steps), or another one at random. A UI
      // preview — it does not move the engine's own step.
      const steps = this.cellEffects(cell).filter((e) => !e.bypass);
      if (steps.length === 0) return;
      const last = this.lastPlayedStep(cell);
      let index: number;
      if (play.mode === 'sequence') index = last === null ? 0 : (last + 1) % steps.length;
      else if (steps.length === 1 || last === null) index = Math.floor(Math.random() * steps.length);
      else index = (last + 1 + Math.floor(Math.random() * (steps.length - 1))) % steps.length;
      this.host.fire.effect(steps[index]!.id);
      return;
    }
    if (this.cellEffects(cell).length > 0) this.host.fire.cell(cell);
  }

  // ---- the one mutation chokepoint -------------------------------------------------------

  /** Run a pure op against the active section; record undo + write back only on a real change. */
  #edit(op: (section: EffectsSection) => EffectsSection): boolean {
    if (!this.host.canEdit()) return false;
    const section = this.host.getSection();
    if (!section) return false;
    const next = op(section);
    if (next === section) return false;
    this.host.undo.push();
    this.host.setSection(next);
    return true;
  }

  #mint(op: (section: EffectsSection) => doc.Minted<EffectsSection>): string | null {
    let id: string | null = null;
    this.#edit((section) => {
      const out = op(section);
      id = out.id;
      return out.section;
    });
    return id;
  }

  // ---- Effects ---------------------------------------------------------------------------

  addEffect(cell: EffectCell, generator: GeneratorKind, style?: string): string | null {
    if (!cellEnabled(this.host.kit(), this.host.inputMap(), cell)) return null;
    const id = this.#mint((s) => doc.addEffect(s, cell, generator, style));
    if (id) this.selectEffect(id);
    return id;
  }
  removeEffect(effectId: string): void {
    this.#edit((s) => doc.removeEffect(s, effectId));
  }
  duplicateEffect(effectId: string): string | null {
    const id = this.#mint((s) => doc.duplicateEffect(s, effectId));
    if (id) this.selectEffect(id);
    return id;
  }
  moveEffect(effectId: string, to: EffectCell, index: number): void {
    if (!cellEnabled(this.host.kit(), this.host.inputMap(), to)) return;
    if (this.#edit((s) => doc.moveEffect(s, effectId, to, index)) && this.#selectedEffectId === effectId) {
      this.selectEffect(effectId);
    }
  }
  renameEffect(effectId: string, name: string): void {
    this.#edit((s) => doc.renameEffect(s, effectId, name));
  }
  setEffectBypass(effectId: string, bypass: boolean): void {
    this.#edit((s) => doc.setEffectBypass(s, effectId, bypass));
  }
  setEffectBlend(effectId: string, blend: BlendMode): void {
    this.#edit((s) => doc.setEffectBlend(s, effectId, blend));
  }
  setEffectOpacity(effectId: string, opacity: number): void {
    this.#edit((s) => doc.setEffectOpacity(s, effectId, opacity));
  }
  setRetrigger(effectId: string, retrigger: Retrigger): void {
    this.#edit((s) => doc.setRetrigger(s, effectId, retrigger));
  }
  setAmp(effectId: string, amp: Partial<AmpEnvelope>): void {
    this.#edit((s) => doc.setAmp(s, effectId, amp));
  }
  /** A move to the zone column keeps the current slot, else lands in the row drum's first zone. */
  setTrigger(effectId: string, trigger: EffectTrigger): void {
    const effect = this.effectById(effectId);
    if (!effect) return;
    const slot = effect.cell.column.kind === 'zone'
      ? effect.cell.column.slot
      : effect.cell.row === effectChain.KIT_ROW
        ? undefined
        : zoneSlotsForDrum(this.host.inputMap(), effect.cell.row)[0];
    if (this.#edit((s) => doc.setTrigger(s, effectId, trigger, slot)) && this.#selectedEffectId === effectId) {
      this.selectEffect(effectId);
    }
  }
  setTarget(effectId: string, target: EffectTarget): void {
    this.#edit((s) => doc.setTarget(s, effectId, target));
  }

  // ---- Generator -------------------------------------------------------------------------

  setGenerator(effectId: string, kind: GeneratorKind, style?: string): void {
    this.#edit((s) => doc.setGenerator(s, effectId, kind, style));
  }
  setGeneratorParam(effectId: string, key: string, value: ParamValue): void {
    this.#edit((s) => doc.setGeneratorParam(s, effectId, key, value));
  }
  setSpliceSlots(effectId: string, slots: SpliceSlot[]): void {
    this.#edit((s) => doc.setSpliceSlots(s, effectId, slots));
  }

  // ---- Modifiers -------------------------------------------------------------------------

  addModifier(owner: ChainOwner, modifierId: string, index?: number): string | null {
    return this.#mint((s) => doc.addModifier(s, owner, modifierId, index));
  }
  removeModifier(owner: ChainOwner, uid: string): void {
    this.#edit((s) => doc.removeModifier(s, owner, uid));
  }
  moveModifier(owner: ChainOwner, uid: string, index: number): void {
    this.#edit((s) => doc.moveModifier(s, owner, uid, index));
  }
  setModifierParam(owner: ChainOwner, uid: string, key: string, value: ParamValue): void {
    this.#edit((s) => doc.setModifierParam(s, owner, uid, key, value));
  }
  setModifierMix(owner: ChainOwner, uid: string, mix: number): void {
    this.#edit((s) => doc.setModifierMix(s, owner, uid, mix));
  }
  setModifierEnvelope(owner: ChainOwner, uid: string, envelope: ModifierEnvelopeSpec | null): void {
    this.#edit((s) => doc.setModifierEnvelope(s, owner, uid, envelope));
  }
  setModifierBypass(owner: ChainOwner, uid: string, bypass: boolean): void {
    this.#edit((s) => doc.setModifierBypass(s, owner, uid, bypass));
  }

  // ---- Controls --------------------------------------------------------------------------

  addControl(effectId: string, kind: ControlKind): string | null {
    return this.#mint((s) => doc.addControl(s, effectId, kind));
  }
  removeControl(effectId: string, uid: string): void {
    this.#edit((s) => doc.removeControl(s, effectId, uid));
  }
  setControlSettings(effectId: string, uid: string, settings: Partial<ControlDevice['settings']>): void {
    this.#edit((s) => doc.setControlSettings(s, effectId, uid, settings));
  }
  addMapping(effectId: string, controlUid: string, mapping: ControlMapping): void {
    this.#edit((s) => doc.addMapping(s, effectId, controlUid, mapping));
  }
  setMapping(effectId: string, controlUid: string, index: number, mapping: Partial<ControlMapping>): void {
    this.#edit((s) => doc.setMapping(s, effectId, controlUid, index, mapping));
  }
  removeMapping(effectId: string, controlUid: string, index: number): void {
    this.#edit((s) => doc.removeMapping(s, effectId, controlUid, index));
  }

  // ---- Cells -----------------------------------------------------------------------------

  /** Copying reads only — allowed for viewers too (the paste is what is guarded). */
  copyCell(cell: EffectCell): void {
    const section = this.host.getSection();
    if (!section) return;
    const stack = doc.copyCell(section, cell);
    if (stack.length > 0) this.#clipboard = stack;
  }
  pasteCell(cell: EffectCell): ApplyResult {
    const stack = this.#clipboard;
    if (!stack || stack.length === 0) return { ok: false, reason: 'Nothing to paste.' };
    if (!this.canEdit) return READ_ONLY;
    if (!cellEnabled(this.host.kit(), this.host.inputMap(), cell)) return { ok: false, reason: 'This cell cannot hold Effects.' };
    let result: ApplyResult = { ok: false, reason: 'Nothing to paste.' };
    this.#edit((s) => {
      const out = doc.pasteCell(s, cell, stack);
      result = out.result;
      return out.section;
    });
    return result;
  }
  get canPasteCell(): boolean {
    return this.canEdit && (this.#clipboard?.length ?? 0) > 0;
  }
  clearCell(cell: EffectCell): void {
    this.#edit((s) => doc.clearCell(s, cell));
  }

  // ---- Cell play ---------------------------------------------------------------------------

  cellPlay(cell: EffectCell): effectChain.CellPlay | null {
    const section = this.host.getSection();
    return section ? effectChain.cellPlayOf(section, cell) : null;
  }
  setCellPlayMode(cell: EffectCell, mode: effectChain.CellPlayMode): void {
    if (!cellEnabled(this.host.kit(), this.host.inputMap(), cell)) return;
    this.#edit((s) => doc.setCellPlayMode(s, cell, mode));
  }
  setCellCut(cell: EffectCell, cut: boolean): void {
    this.#edit((s) => doc.setCellCut(s, cell, cut));
  }
  setCellReset(cell: EffectCell, reset: effectChain.CellReset | null): void {
    this.#edit((s) => doc.setCellReset(s, cell, reset));
  }
  startCellResetLearn(cell: EffectCell, via: 'midi' | 'osc'): void {
    if (!this.canEdit || !this.cellPlay(cell)) return;
    this.host.learn.startReset(doc.cloneJson(cell), via);
  }
  get cellResetLearnCell(): EffectCell | null {
    return this.host.learn.resetCell();
  }
  lastPlayedStep(cell: EffectCell): number | null {
    // The steps are the cell's un-bypassed Effects in stack order — exactly what the engine steps.
    const steps = this.cellEffects(cell).filter((e) => !e.bypass);
    let best = -1;
    let at = 0;
    steps.forEach((effect, index) => {
      const fired = this.effectFireAt(effect.id);
      if (fired > at) {
        at = fired;
        best = index;
      }
    });
    return best < 0 ? null : best;
  }

  // ---- Cue learn -------------------------------------------------------------------------

  startCueLearn(effectId: string, via: 'midi' | 'osc'): void {
    const effect = this.effectById(effectId);
    if (!this.canEdit || !effect || effect.trigger.kind !== 'cue') return;
    this.host.learn.start(effectId, via);
  }
  cancelCueLearn(): void {
    this.host.learn.cancel();
  }
  get cueLearnEffectId(): string | null {
    return this.host.learn.effectId();
  }

  // ---- Files -----------------------------------------------------------------------------

  async saveEffectToFile(effectId: string): Promise<void> {
    const effect = this.effectById(effectId);
    if (effect) await this.host.files.saveEffect(effect);
  }
  async saveCellToFile(cell: EffectCell): Promise<void> {
    const stack = this.cellEffects(cell);
    if (stack.length > 0) await this.host.files.saveCell(cell, stack);
  }
  async saveDeviceToFile(effectId: string, device: 'generator' | string): Promise<void> {
    const effect = this.effectById(effectId);
    if (!effect) return;
    const known = device === 'generator'
      || effect.modifiers.some((m) => m.uid === device)
      || effect.controls.some((c) => c.uid === device);
    if (known) await this.host.files.saveDevice(effect, device);
  }
  async loadFileIntoCell(cell: EffectCell): Promise<ApplyResult> {
    if (!this.canEdit) return READ_ONLY;
    if (!cellEnabled(this.host.kit(), this.host.inputMap(), cell)) return { ok: false, reason: 'This cell cannot hold Effects.' };
    return this.host.files.loadIntoCell(cell);
  }
  async loadFileIntoEffect(effectId: string): Promise<ApplyResult> {
    if (!this.canEdit) return READ_ONLY;
    if (!this.effectById(effectId)) return { ok: false, reason: 'That Effect no longer exists.' };
    return this.host.files.loadIntoEffect(effectId);
  }

  // ---- Undo bracketing -------------------------------------------------------------------

  beginGesture(): void {
    if (this.host.canEdit()) this.host.undo.beginGesture();
  }
  endGesture(): void {
    this.host.undo.endGesture();
  }

  // ---- Legacy import ---------------------------------------------------------------------

  get legacyImportAvailable(): boolean {
    return this.host.legacyImport.available();
  }
  get legacyShowNames(): readonly string[] {
    return this.host.legacyImport.showNames();
  }
  importLegacyShows(): ApplyResult {
    return this.host.legacyImport.run();
  }
  dismissLegacyImport(): void {
    this.host.legacyImport.dismiss();
  }
}

// ---- Standalone (in-memory) host ------------------------------------------------------------

export interface StandaloneEffectsOptions {
  /** Defaults to declaring zone slots 0 and 1 on every drum. */
  inputMap?: InputMap;
  canEdit?: boolean;
  sectionId?: string;
}

/** The in-memory document behind a {@link StandaloneEffectsApi}. */
interface StandaloneState {
  section: EffectsSection;
  canEdit: boolean;
  history: EffectsSection[];
  fired: string[];
}

/** A controller over an in-memory section, with a snapshot undo stack and a fire log. */
export class StandaloneEffectsApi extends EffectsController {
  readonly #state: StandaloneState;
  constructor(state: StandaloneState, host: EffectsControllerHost) {
    super(host);
    this.#state = state;
  }
  /** The current in-memory section. */
  get section(): EffectsSection {
    return this.#state.section;
  }
  /** Toggle edit rights (viewer simulation). */
  setCanEdit(canEdit: boolean): void {
    this.#state.canEdit = canEdit;
  }
  /** Undo depth: one entry per recorded checkpoint. */
  get undoDepth(): number {
    return this.#state.history.length;
  }
  /** Restore the last checkpoint. False when there is none. */
  undo(): boolean {
    const prev = this.#state.history.at(-1);
    if (!prev) return false;
    this.#state.history = this.#state.history.slice(0, -1);
    this.#state.section = prev;
    return true;
  }
  /** Every audition, in order: `effect:<id>` or `cell:<row>/<column>`. */
  get fired(): readonly string[] {
    return this.#state.fired;
  }
}

function cellKey(cell: EffectCell): string {
  const col = cell.column.kind === 'zone' ? `zone${cell.column.slot}` : cell.column.kind;
  return `${cell.row}/${col}`;
}

function defaultInputMap(kit: KitConfig): InputMap {
  return inputMapSchema.parse({
    zones: kit.drums.flatMap((d) => [0, 1].map((slot) => ({ drumId: d.id, slot }))),
  });
}

const NO_FILES: ApplyResult = { ok: false, reason: 'Files are not available here.' };

/**
 * An in-memory {@link EffectsAuthoringApi} for styleguide demos and component tests: edits apply
 * to a local section, undo is a snapshot stack (a gesture folds to one entry), fires are logged
 * and stamp fire times, files and legacy import are unavailable, cue learn is local state.
 *
 * The document fields are `$state.raw`-style: every edit replaces the section value (the pure
 * ops never mutate), so reassignment is the reactivity signal and no deep proxies are created.
 */
export function createStandaloneEffectsApi(
  initialSection: EffectsSection,
  kit: KitConfig,
  options: StandaloneEffectsOptions = {},
): StandaloneEffectsApi {
  let section = $state.raw(doc.cloneJson(initialSection));
  let canEdit = $state.raw(options.canEdit ?? true);
  let history = $state.raw<EffectsSection[]>([]);
  let fired = $state.raw<string[]>([]);
  let fireTimes = $state.raw<Record<string, number>>({});
  let learnId = $state.raw<string | null>(null);
  let resetLearn = $state.raw<EffectCell | null>(null);
  const state: StandaloneState = {
    get section() { return section; },
    set section(next) { section = next; },
    get canEdit() { return canEdit; },
    set canEdit(next) { canEdit = next; },
    get history() { return history; },
    set history(next) { history = next; },
    get fired() { return fired; },
    set fired(next) { fired = next; },
  };
  const inputMap = options.inputMap ?? defaultInputMap(kit);
  let gestureDepth = 0;
  let gestureTaken = false;
  const stamp = (key: string): void => {
    fired = [...fired, key];
    fireTimes = { ...fireTimes, [key]: performance.now() };
  };

  const host: EffectsControllerHost = {
    getSection: () => section,
    setSection: (next) => {
      section = next;
    },
    activeSectionId: () => options.sectionId ?? 'section-demo',
    canEdit: () => canEdit,
    kit: () => kit,
    inputMap: () => inputMap,
    undo: {
      push: () => {
        if (gestureDepth > 0) {
          if (gestureTaken) return;
          gestureTaken = true;
        }
        history = [...history, section];
      },
      beginGesture: () => {
        if (gestureDepth === 0) gestureTaken = false;
        gestureDepth += 1;
      },
      endGesture: () => {
        if (gestureDepth > 0) gestureDepth -= 1;
      },
    },
    fire: {
      effect: (id) => stamp(`effect:${id}`),
      cell: (cell) => stamp(`cell:${cellKey(cell)}`),
      effectFireAt: (id) => fireTimes[`effect:${id}`] ?? 0,
      cellFireAt: (cell) => fireTimes[`cell:${cellKey(cell)}`] ?? 0,
    },
    files: {
      saveEffect: async () => {},
      saveCell: async () => {},
      saveDevice: async () => {},
      loadIntoCell: async () => NO_FILES,
      loadIntoEffect: async () => NO_FILES,
    },
    learn: {
      start: (id) => {
        learnId = id;
      },
      cancel: () => {
        learnId = null;
        resetLearn = null;
      },
      effectId: () => learnId,
      startReset: (cell) => {
        resetLearn = cell;
      },
      resetCell: () => resetLearn,
    },
    legacyImport: {
      available: () => false,
      showNames: () => [],
      run: () => ({ ok: false, reason: 'No old shows to import.' }),
      dismiss: () => {},
    },
  };
  return new StandaloneEffectsApi(state, host);
}
