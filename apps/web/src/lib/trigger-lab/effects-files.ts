/* Effect-chain files — save / load an Effect, a cell's stack, or one device (spec "Presets and
   files", stories 63–65). The IO-free half: build the file text, and apply loaded text to a
   section value. The store wraps these with `file-io.ts` (the picker) and its undo / guard /
   autosave machinery; nothing here touches a file, the store or runes, so every rule is
   unit-testable.

   Each `apply*` takes the section as a value and returns the NEXT section value (the input is
   never mutated) plus an {@link ApplyResult}. On failure the returned section is the input, by
   reference. A load also returns the canvas scenes the file brought that the show does not
   already have (reused by content, see `remapEffectsClipDoc`) — the caller unions them into the
   show's `canvasScenes` in the same undo step.

   Placement rules for a loaded Effect (agent-chosen, documented here):
   - it always gets a fresh Effect id and fresh device uids (unique across the section), and its
     control mappings follow its modifiers' new uids;
   - it lands at the TOP of the destination cell's stack (appended to `section.effects`), a cell
     file's stack keeping its own order;
   - its trigger keeps its settings when the destination column has the same kind, else it takes
     that column's default trigger;
   - a Target that was its source row's default (whole kit / its own drum) follows the row it
     lands in; an explicit Target selection is kept. */

import { effectChain, type CanvasScene } from '@ledrums/core';
import {
  buildCellClipDoc,
  buildDeviceClipDoc,
  buildEffectClipDoc,
  isClipParseError,
  isEffectsClipDoc,
  parse,
  remapEffectsClipDoc,
  serialize,
  type ClipDocMeta,
  type ClipParseReason,
  type EffectDevicePayload,
  type EffectsClipDoc,
  type EffectsClipSources,
  type EffectsRemapContext,
} from './clipdoc';
import { MASTER_CELL, type ApplyResult } from './effects-api';
import { freshId } from './store/ids';

type Effect = effectChain.Effect;
type EffectCell = effectChain.EffectCell;
type ModifierDevice = effectChain.ModifierDevice;
type ControlDevice = effectChain.ControlDevice;

/** Effect / cell / device files end in their own double extension (like graph / node files). */
export const EFFECT_FILE_EXT = '.ledrums-effect.json';
export const CELL_FILE_EXT = '.ledrums-cell.json';
export const DEVICE_FILE_EXT = '.ledrums-device.json';

/** The part of an authored section these files read and write. Any other field rides through. */
export interface EffectsFileSection {
  effects: readonly Effect[];
  master: readonly ModifierDevice[];
}

/** A file ready to hand to `saveTextFile`. */
export interface EffectsFile {
  fileName: string;
  text: string;
}

/** Local show state a load reconciles against, plus injectable id minters (tests). */
export interface EffectsFileContext extends EffectsRemapContext {
  /** Fresh Effect id; `taken` answers for ids already in the section or minted this load. */
  mintEffectId?: (taken: (id: string) => boolean) => string;
  /** Fresh device uid; `taken` covers every uid in the section (Effects and master). */
  mintUid?: (taken: (uid: string) => boolean) => string;
}

export interface EffectsFileApplied<S extends EffectsFileSection> {
  section: S;
  result: ApplyResult;
  /** Scenes to add to the show (empty on failure). */
  canvasScenes: CanvasScene[];
  /** Ids of the Effects the load placed, in stack order (empty for device loads / failure). */
  effectIds: string[];
}

// ---- save ------------------------------------------------------------------------

/** A file name safe on every OS (mirrors `file-io.safeFileName`, kept local so this stays IO-free). */
function baseName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return cleaned || fallback;
}

function effectLabel(effect: Effect): string {
  return effect.name.trim() || effect.generator.kind;
}

/** The file for one Effect. */
export function effectFile(effect: Effect, sources: EffectsClipSources, meta?: Partial<ClipDocMeta>): EffectsFile {
  return {
    fileName: baseName(effectLabel(effect), 'effect') + EFFECT_FILE_EXT,
    text: serialize(buildEffectClipDoc(effect, sources, meta)),
  };
}

/** The file for a cell's stack. `effects` is the stack in stack order. */
export function cellFile(cell: EffectCell, effects: readonly Effect[], sources: EffectsClipSources, meta?: Partial<ClipDocMeta>): EffectsFile {
  const name = effects.length === 1 ? effectLabel(effects[0]!) : `${cell.row} ${cell.column.kind === 'zone' ? `zone ${cell.column.slot}` : cell.column.kind}`;
  return {
    fileName: baseName(name, 'cell') + CELL_FILE_EXT,
    text: serialize(buildCellClipDoc(cell, effects, sources, meta)),
  };
}

/** The file for one device. */
export function deviceFile(device: EffectDevicePayload, sources: EffectsClipSources, meta?: Partial<ClipDocMeta>): EffectsFile {
  const name = device.device === 'generator'
    ? device.generator.kind
    : device.device === 'modifier' ? device.modifier.modifierId : device.control.kind;
  return {
    fileName: baseName(name, 'device') + DEVICE_FILE_EXT,
    text: serialize(buildDeviceClipDoc(device, sources, meta)),
  };
}

/**
 * Find a device to save: `'generator'` or a modifier / control uid of the Effect, or a master
 * modifier uid when `effectId` is {@link MASTER_CELL}. `null` when it doesn't exist.
 */
export function findDevice(section: EffectsFileSection, effectId: string, device: 'generator' | string): EffectDevicePayload | null {
  if (effectId === MASTER_CELL) {
    const modifier = section.master.find((m) => m.uid === device);
    return modifier ? { device: 'modifier', modifier } : null;
  }
  const effect = section.effects.find((e) => e.id === effectId);
  if (!effect) return null;
  if (device === 'generator') return { device: 'generator', generator: effect.generator };
  const modifier = effect.modifiers.find((m) => m.uid === device);
  if (modifier) return { device: 'modifier', modifier };
  const control = effect.controls.find((c) => c.uid === device);
  return control ? { device: 'control', control } : null;
}

// ---- load ------------------------------------------------------------------------

const KIND_NOUN: Record<EffectsClipDoc['kind'], string> = { effect: 'an Effect', cell: 'a cell', device: 'a device' };

/** A parse failure, worded for a file the user picked. */
function parseReason(reason: ClipParseReason): string {
  switch (reason) {
    case 'foreign':
      return 'That file isn’t a LEDrums file.';
    case 'unsupported-version':
      return 'That file was saved by a newer version of LEDrums.';
    default:
      return 'That file couldn’t be read as a LEDrums Effect, cell or device.';
  }
}

function fail<S extends EffectsFileSection>(section: S, reason: string): EffectsFileApplied<S> {
  return { section, result: { ok: false, reason }, canvasScenes: [], effectIds: [] };
}

/** Parse text as one of the wanted effect-chain kinds, or say why not. */
function readDoc(text: string, want: readonly EffectsClipDoc['kind'][]): EffectsClipDoc | { reason: string } {
  const doc = parse(text);
  if (isClipParseError(doc)) return { reason: parseReason(doc.reason) };
  if (!isEffectsClipDoc(doc)) return { reason: `That file holds a ${doc.kind} from the old graph editor, which can’t be loaded here.` };
  if (!want.includes(doc.kind)) return { reason: `That file holds ${KIND_NOUN[doc.kind]}, not ${want.map((k) => KIND_NOUN[k]).join(' or ')}.` };
  return doc;
}

/** Every device uid in the section (Effects and master). */
function sectionUids(section: EffectsFileSection): Set<string> {
  const out = new Set(section.master.map((m) => m.uid));
  for (const effect of section.effects) {
    for (const m of effect.modifiers) out.add(m.uid);
    for (const c of effect.controls) out.add(c.uid);
  }
  return out;
}

/** Id minting for one load: every id it hands out is unique in the section AND in this load. */
function minters(section: EffectsFileSection, ctx: EffectsFileContext): { effectId: () => string; uid: () => string } {
  const effectIds = new Set(section.effects.map((e) => e.id));
  const uids = sectionUids(section);
  const mintEffectId = ctx.mintEffectId ?? ((taken) => freshId('fx', taken));
  const mintUid = ctx.mintUid ?? ((taken) => freshId('dev', taken));
  return {
    effectId: () => {
      const id = mintEffectId((candidate) => effectIds.has(candidate));
      effectIds.add(id);
      return id;
    },
    uid: () => {
      const uid = mintUid((candidate) => uids.has(candidate));
      uids.add(uid);
      return uid;
    },
  };
}

/** Why an Effect can't live in `cell`, or null when it can. */
function cellProblem(cell: EffectCell): string | null {
  if (cell.row === effectChain.KIT_ROW && cell.column.kind === 'zone') return 'The Kit row has no zone cells.';
  return null;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Give an Effect fresh ids and put it in `cell` (see the placement rules at the top). */
function placeEffect(effect: Effect, cell: EffectCell, mint: ReturnType<typeof minters>): Effect | null {
  const uidMap = new Map<string, string>();
  const modifiers = effect.modifiers.map((m) => {
    const uid = mint.uid();
    uidMap.set(m.uid, uid);
    return { ...structuredClone(m), uid };
  });
  const controls: ControlDevice[] = effect.controls.map((c) => ({
    ...structuredClone(c),
    uid: mint.uid(),
    mappings: c.mappings.map((mapping) => ({ ...mapping, device: uidMap.get(mapping.device) ?? mapping.device })),
  }));
  const trigger = effect.trigger.kind === cell.column.kind
    ? structuredClone(effect.trigger)
    : effectChain.effectTriggerSchema.parse({ kind: cell.column.kind });
  const followsRow = sameJson(effect.target, effectChain.defaultTargetForRow(effect.cell.row));
  const target = followsRow ? effectChain.defaultTargetForRow(cell.row) : structuredClone(effect.target);
  const parsed = effectChain.effectSchema.safeParse({
    ...structuredClone(effect),
    id: mint.effectId(),
    cell: structuredClone(cell),
    trigger,
    target,
    modifiers,
    controls,
  });
  return parsed.success ? parsed.data : null;
}

function placeStack<S extends EffectsFileSection>(
  section: S,
  cell: EffectCell,
  effects: readonly Effect[],
  canvasScenes: CanvasScene[],
  ctx: EffectsFileContext,
): EffectsFileApplied<S> {
  const problem = cellProblem(cell);
  if (problem) return fail(section, problem);
  if (effects.length === 0) return fail(section, 'That file holds an empty cell.');
  const mint = minters(section, ctx);
  const placed: Effect[] = [];
  for (const effect of effects) {
    const next = placeEffect(effect, cell, mint);
    if (!next) return fail(section, 'That Effect can’t be placed in this cell.');
    placed.push(next);
  }
  return {
    section: { ...section, effects: [...section.effects, ...placed] },
    result: { ok: true },
    canvasScenes,
    effectIds: placed.map((effect) => effect.id),
  };
}

/** Load an Effect file into `cell` (on top of its stack). */
export function applyEffectFile<S extends EffectsFileSection>(section: S, cell: EffectCell, text: string, ctx: EffectsFileContext = {}): EffectsFileApplied<S> {
  const doc = readDoc(text, ['effect']);
  if ('reason' in doc) return fail(section, doc.reason);
  const { doc: local, canvasScenes } = remapEffectsClipDoc(doc as EffectsClipDoc & { kind: 'effect' }, ctx);
  return placeStack(section, cell, [local.payload.effect], canvasScenes, ctx);
}

/** Load a cell file's stack into `cell` (on top of its stack, in the file's order). */
export function applyCellFile<S extends EffectsFileSection>(section: S, cell: EffectCell, text: string, ctx: EffectsFileContext = {}): EffectsFileApplied<S> {
  const doc = readDoc(text, ['cell']);
  if ('reason' in doc) return fail(section, doc.reason);
  const { doc: local, canvasScenes } = remapEffectsClipDoc(doc as EffectsClipDoc & { kind: 'cell' }, ctx);
  return placeStack(section, cell, local.payload.effects, canvasScenes, ctx);
}

/** Load an Effect OR a cell file into `cell` — the grid cell menu's one "Load" action. */
export function applyFileToCell<S extends EffectsFileSection>(section: S, cell: EffectCell, text: string, ctx: EffectsFileContext = {}): EffectsFileApplied<S> {
  const doc = readDoc(text, ['effect', 'cell']);
  if ('reason' in doc) return fail(section, doc.reason);
  return doc.kind === 'cell' ? applyCellFile(section, cell, text, ctx) : applyEffectFile(section, cell, text, ctx);
}

/**
 * Load a device file into an Effect (or the master chain with {@link MASTER_CELL}):
 * - a Generator replaces the Effect's Generator (modifiers, controls and Target are kept);
 * - a Modifier is appended to the chain with a fresh uid;
 * - a Control is appended with a fresh uid. Only its mappings onto the Generator are kept: the
 *   others named modifiers of the Effect it was saved from.
 * The master chain takes Modifiers only.
 */
export function applyDeviceFile<S extends EffectsFileSection>(section: S, effectId: string, text: string, ctx: EffectsFileContext = {}): EffectsFileApplied<S> {
  const doc = readDoc(text, ['device']);
  if ('reason' in doc) return fail(section, doc.reason);
  const { doc: local, canvasScenes } = remapEffectsClipDoc(doc as EffectsClipDoc & { kind: 'device' }, ctx);
  const payload = local.payload;
  const ok = (next: S): EffectsFileApplied<S> => ({ section: next, result: { ok: true }, canvasScenes, effectIds: [] });
  const mint = minters(section, ctx);

  if (effectId === MASTER_CELL) {
    if (payload.device !== 'modifier') return fail(section, 'The Master chain only takes modifiers.');
    return ok({ ...section, master: [...section.master, { ...payload.modifier, uid: mint.uid() }] });
  }
  const index = section.effects.findIndex((e) => e.id === effectId);
  const effect = section.effects[index];
  if (!effect) return fail(section, 'That Effect is gone.');
  let next: Effect;
  if (payload.device === 'generator') next = { ...effect, generator: payload.generator };
  else if (payload.device === 'modifier') next = { ...effect, modifiers: [...effect.modifiers, { ...payload.modifier, uid: mint.uid() }] };
  else {
    const control: ControlDevice = {
      ...payload.control,
      uid: mint.uid(),
      mappings: payload.control.mappings.filter((mapping) => mapping.device === 'generator'),
    };
    next = { ...effect, controls: [...effect.controls, control] };
  }
  const effects = section.effects.slice();
  effects[index] = next;
  return ok({ ...section, effects });
}

/**
 * Load an Effect or a device file onto an existing Effect — the Effect header's "Load" action.
 * A device file goes through {@link applyDeviceFile}. An Effect file replaces the Effect's
 * contents in place: it keeps its id, its cell and its position in the stack (like loading a
 * graph file onto a graph), the rest follows the placement rules.
 */
export function applyFileToEffect<S extends EffectsFileSection>(section: S, effectId: string, text: string, ctx: EffectsFileContext = {}): EffectsFileApplied<S> {
  const doc = readDoc(text, ['effect', 'device']);
  if ('reason' in doc) return fail(section, doc.reason);
  if (doc.kind === 'device') return applyDeviceFile(section, effectId, text, ctx);
  const index = section.effects.findIndex((e) => e.id === effectId);
  const current = section.effects[index];
  if (!current) return fail(section, 'That Effect is gone.');
  const { doc: local, canvasScenes } = remapEffectsClipDoc(doc as EffectsClipDoc & { kind: 'effect' }, ctx);
  // Mint against the section WITHOUT the Effect being replaced, so its own uids are free to reuse.
  const rest = { ...section, effects: section.effects.filter((e) => e.id !== effectId) };
  const mint = minters(rest, { ...ctx, mintEffectId: () => effectId });
  const placed = placeEffect(local.payload.effect, current.cell, mint);
  if (!placed) return fail(section, 'That Effect can’t be placed in this cell.');
  const effects = section.effects.slice();
  effects[index] = placed;
  return { section: { ...section, effects }, result: { ok: true }, canvasScenes, effectIds: [effectId] };
}
