/* Effects document ops (effect chains, S05 §2) — the PURE section mutations behind every
   `EffectsAuthoringApi` mutator. A section value goes in; a new section value (or the SAME value,
   meaning "no-op") comes out. No runes, no store, no IO: the `EffectsController` wraps these with
   the viewer / undo / autosave plumbing, and tests drive them directly.

   Rules shared by every op:
   - The section's `effects` array order is the composition order. The grid groups it by cell;
     a cell's stack is the array filtered to that cell, in array order.
   - Every edited Effect / device is re-validated with the core schema. An edit the schema
     rejects (a zone column on the Kit row, an out-of-range setting) returns the input unchanged,
     so a bad UI value can never persist an Effect the runtime would drop.
   - Returning the input value unchanged is the no-op signal (the controller then records no undo
     step). Nothing here mutates its input.
   - Fresh ids come from the store's one id factory (`store/ids.ts`), checked against the section
     (Effect ids) or the owning chain (device uids) so a restored library can never collide. */

import { effectChain, tryGetModifier } from '@ledrums/core';
import { freshId } from './store/ids';
import { MASTER_CELL, type ApplyResult } from './effects-api';

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

/** The part of an authored section these ops read and write. Extra fields pass through. */
export interface EffectsSection {
  effects: Effect[];
  master: ModifierDevice[];
  /** Sequence / Random cells (see core `effect-chain/cell-play`). Absent = all cells layer. */
  cellPlay?: effectChain.CellPlay[];
}

/** An op that mints an id: the new section plus the id (null + the input section on a no-op). */
export interface Minted<S> {
  section: S;
  id: string | null;
}

/** Which modifier chain an op addresses: an Effect's (by id) or the section master. */
export type ChainOwner = string | typeof MASTER_CELL;

/** Deep copy of JSON-shaped authored data. Not `structuredClone`: callers may hand in Svelte
    `$state` proxies, which structured cloning rejects. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---- cells ------------------------------------------------------------------------------

export function sameCell(a: EffectCell, b: EffectCell): boolean {
  if (a.row !== b.row || a.column.kind !== b.column.kind) return false;
  return a.column.kind !== 'zone' || (b.column.kind === 'zone' && a.column.slot === b.column.slot);
}

/** The cell's stack, in stack (composition) order. */
export function cellEffects(section: EffectsSection, cell: EffectCell): Effect[] {
  return section.effects.filter((e) => sameCell(e.cell, cell));
}

export function effectById(section: EffectsSection, effectId: string): Effect | undefined {
  return section.effects.find((e) => e.id === effectId);
}

function targetsEqual(a: EffectTarget, b: EffectTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A trigger for `cell`: the effect's own when its kind already matches the column, else the
    column's default trigger. */
function triggerForCell(current: EffectTrigger | undefined, cell: EffectCell): EffectTrigger {
  if (current && current.kind === cell.column.kind) return current;
  return effectChain.effectTriggerSchema.parse({ kind: cell.column.kind });
}

/** Re-home an Effect into `cell`: the trigger follows the column, and a Target that was the old
    row's default follows the row (a custom Target is the author's and is kept). `null` when the
    schema rejects the result (e.g. a zone column on the Kit row). */
function relocate(effect: Effect, cell: EffectCell): Effect | null {
  const target = targetsEqual(effect.target, effectChain.defaultTargetForRow(effect.cell.row))
    ? effectChain.defaultTargetForRow(cell.row)
    : effect.target;
  return validEffect({ ...effect, cell: cloneJson(cell), trigger: triggerForCell(effect.trigger, cell), target });
}

function validEffect(candidate: unknown): Effect | null {
  const parsed = effectChain.effectSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function withEffects<S extends EffectsSection>(section: S, effects: Effect[]): S {
  return { ...section, effects };
}

/** Replace one Effect via `edit`; the input section when the Effect is missing, `edit` returns
    null / the same Effect, or the edited Effect fails validation. */
function updateEffect<S extends EffectsSection>(section: S, effectId: string, edit: (e: Effect) => unknown): S {
  const index = section.effects.findIndex((e) => e.id === effectId);
  if (index < 0) return section;
  const current = section.effects[index]!;
  const edited = edit(current);
  if (edited == null || edited === current) return section;
  const next = validEffect(edited);
  if (!next) return section;
  return withEffects(section, section.effects.map((e, i) => (i === index ? next : e)));
}

function freshEffectId(section: EffectsSection, taken: ReadonlySet<string> = new Set()): string {
  return freshId('fx', (id) => taken.has(id) || section.effects.some((e) => e.id === id));
}

/** The default name for a new Effect: the Style's label, else the Generator's. */
export function defaultEffectName(kind: GeneratorKind, style?: string): string {
  const def = effectChain.getGeneratorDef(kind);
  if (!def) return kind;
  const picked = style ? def.styles.find((s) => s.id === style) : undefined;
  return picked?.label ?? def.label;
}

/**
 * Whether `style` names a Style the runtime can resolve for `kind`. An empty Style (the
 * Generator's first) and Generators that resolve themselves or carry no Styles (Splice / Slice /
 * Scene) always pass; otherwise the id must be one of the def's Styles. The Effect schema accepts
 * any string here, so without this an unknown Style would persist and core would skip the Effect.
 */
function validStyle(kind: GeneratorKind, style: string | undefined): boolean {
  const def = effectChain.getGeneratorDef(kind);
  if (!def) return false;
  if (!style || def.resolve || def.styles.length === 0) return true;
  return def.styles.some((s) => s.id === style);
}

// ---- Effects ----------------------------------------------------------------------------

/** Append a new Effect to `cell` (on top of the cell's stack; last in composition order). */
export function addEffect<S extends EffectsSection>(
  section: S,
  cell: EffectCell,
  generator: GeneratorKind,
  style?: string,
): Minted<S> {
  if (!validStyle(generator, style)) return { section, id: null };
  const id = freshEffectId(section);
  const effect = validEffect({
    id,
    name: defaultEffectName(generator, style),
    cell: cloneJson(cell),
    generator: { kind: generator, style: style ?? '' },
    // A Slice cuts through the whole kit by default (the graph Slice node's "On: Kit"), so its
    // slabs read across drums instead of only across the drum whose cell it sits in.
    ...(generator === 'slice' ? { target: { kind: 'kit' as const } } : {}),
  });
  if (!effect) return { section, id: null };
  return { section: withEffects(section, [...section.effects, effect]), id };
}

export function removeEffect<S extends EffectsSection>(section: S, effectId: string): S {
  if (!section.effects.some((e) => e.id === effectId)) return section;
  return withEffects(section, section.effects.filter((e) => e.id !== effectId));
}

/** Copy an Effect (fresh id, " copy" suffix) directly above the source in its cell's stack. */
export function duplicateEffect<S extends EffectsSection>(section: S, effectId: string): Minted<S> {
  const index = section.effects.findIndex((e) => e.id === effectId);
  if (index < 0) return { section, id: null };
  const source = section.effects[index]!;
  const id = freshEffectId(section);
  const copy: Effect = { ...cloneJson(source), id, name: source.name ? `${source.name} copy` : '' };
  const effects = [...section.effects];
  effects.splice(index + 1, 0, copy);
  return { section: withEffects(section, effects), id };
}

/**
 * Move an Effect within its cell's stack or into another cell at stack position `index`
 * (clamped). Effects in other cells keep their relative order. Moving into an empty cell keeps
 * the Effect's composition position. A cross-column move re-derives the trigger; a cross-row
 * move re-derives a default Target. No-op when the destination is invalid for the Effect.
 */
export function moveEffect<S extends EffectsSection>(section: S, effectId: string, to: EffectCell, index: number): S {
  const from = section.effects.findIndex((e) => e.id === effectId);
  if (from < 0) return section;
  const current = section.effects[from]!;
  const moved = sameCell(current.cell, to) ? current : relocate(current, to);
  if (!moved) return section;
  const rest = section.effects.filter((e) => e.id !== effectId);
  const stack = rest.filter((e) => sameCell(e.cell, to));
  const position = Math.max(0, Math.min(Math.trunc(index), stack.length));
  // Same cell, same stack position: nothing moves (and composition order stays untouched).
  if (moved === current && cellEffects(section, to).indexOf(current) === position) return section;
  let insertAt: number;
  if (stack.length === 0) insertAt = from;
  else if (position < stack.length) insertAt = rest.indexOf(stack[position]!);
  else insertAt = rest.indexOf(stack[stack.length - 1]!) + 1;
  const effects = [...rest];
  effects.splice(insertAt, 0, moved);
  if (moved === current && effects.every((e, i) => e === section.effects[i])) return section;
  return withEffects(section, effects);
}

export function renameEffect<S extends EffectsSection>(section: S, effectId: string, name: string): S {
  const trimmed = name.trim();
  return updateEffect(section, effectId, (e) => (e.name === trimmed ? null : { ...e, name: trimmed }));
}

export function setEffectBypass<S extends EffectsSection>(section: S, effectId: string, bypass: boolean): S {
  return updateEffect(section, effectId, (e) => (e.bypass === bypass ? null : { ...e, bypass }));
}

export function setEffectBlend<S extends EffectsSection>(section: S, effectId: string, blend: BlendMode): S {
  return updateEffect(section, effectId, (e) => (e.blend === blend ? null : { ...e, blend }));
}

/** Opacity is clamped to 0..1 (a slider overshoot never persists an invalid Effect). */
export function setEffectOpacity<S extends EffectsSection>(section: S, effectId: string, opacity: number): S {
  if (!Number.isFinite(opacity)) return section;
  const clamped = Math.max(0, Math.min(1, opacity));
  return updateEffect(section, effectId, (e) => (e.opacity === clamped ? null : { ...e, opacity: clamped }));
}

export function setRetrigger<S extends EffectsSection>(section: S, effectId: string, retrigger: Retrigger): S {
  return updateEffect(section, effectId, (e) => (e.retrigger === retrigger ? null : { ...e, retrigger }));
}

export function setAmp<S extends EffectsSection>(section: S, effectId: string, amp: Partial<AmpEnvelope>): S {
  return updateEffect(section, effectId, (e) => {
    const next = { ...e.amp, ...amp };
    return JSON.stringify(next) === JSON.stringify(e.amp) ? null : { ...e, amp: next };
  });
}

/**
 * Set the trigger. Same kind: its settings change in place. A different kind moves the Effect to
 * that column of its row (keeping its composition position); a zone trigger lands in
 * `zoneSlot`, which the caller picks from the row drum's zones (no slot → no-op).
 */
export function setTrigger<S extends EffectsSection>(
  section: S,
  effectId: string,
  trigger: EffectTrigger,
  zoneSlot?: number,
): S {
  return updateEffect(section, effectId, (e) => {
    if (trigger.kind === e.trigger.kind) {
      return JSON.stringify(trigger) === JSON.stringify(e.trigger) ? null : { ...e, trigger: cloneJson(trigger) };
    }
    let column: EffectCell['column'];
    if (trigger.kind === 'zone') {
      if (zoneSlot == null) return null;
      column = { kind: 'zone', slot: zoneSlot };
    } else {
      column = { kind: trigger.kind };
    }
    return { ...e, cell: { row: e.cell.row, column }, trigger: cloneJson(trigger) };
  });
}

export function setTarget<S extends EffectsSection>(section: S, effectId: string, target: EffectTarget): S {
  return updateEffect(section, effectId, (e) => (targetsEqual(e.target, target) ? null : { ...e, target: cloneJson(target) }));
}

// ---- Generator --------------------------------------------------------------------------

const SLOTTED: ReadonlySet<GeneratorKind> = new Set(['splice', 'slice']);

/**
 * Swap the Generator's kind / Style. Modifiers, controls (and their mappings), target, amp and
 * the Effect settings are kept. Authored params reset (the old Style's params don't describe the
 * new one); Splice / Slice slots survive a Splice ↔ Slice swap only.
 */
export function setGenerator<S extends EffectsSection>(section: S, effectId: string, kind: GeneratorKind, style?: string): S {
  if (!validStyle(kind, style)) return section;
  const nextStyle = style ?? '';
  return updateEffect(section, effectId, (e) => {
    if (e.generator.kind === kind && e.generator.style === nextStyle) return null;
    const keepSlots = SLOTTED.has(kind) && SLOTTED.has(e.generator.kind) && e.generator.slots;
    const generator: effectChain.GeneratorDevice = { kind, style: nextStyle, params: {} };
    if (keepSlots) generator.slots = cloneJson(e.generator.slots);
    // Switching TO Slice from a drum's default Target widens it to the kit, as a new Slice starts.
    const widen = kind === 'slice' && e.generator.kind !== 'slice' && JSON.stringify(e.target) === JSON.stringify(effectChain.defaultTargetForRow(e.cell.row));
    return widen ? { ...e, generator, target: { kind: 'kit' } } : { ...e, generator };
  });
}

export function setGeneratorParam<S extends EffectsSection>(section: S, effectId: string, key: string, value: ParamValue): S {
  return updateEffect(section, effectId, (e) =>
    e.generator.params[key] === value ? null : { ...e, generator: { ...e.generator, params: { ...e.generator.params, [key]: value } } },
  );
}

/** Several Generator params in one edit; `undefined` removes a param (a Slice's Space box). */
export function setGeneratorParams<S extends EffectsSection>(section: S, effectId: string, patch: Readonly<Record<string, ParamValue | undefined>>): S {
  return updateEffect(section, effectId, (e) => {
    const params: Record<string, ParamValue> = { ...e.generator.params };
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        if (key in params) {
          delete params[key];
          changed = true;
        }
      } else if (params[key] !== value) {
        params[key] = value;
        changed = true;
      }
    }
    return changed ? { ...e, generator: { ...e.generator, params } } : null;
  });
}

/** Only a Splice / Slice Generator has slots. */
export function setSpliceSlots<S extends EffectsSection>(section: S, effectId: string, slots: SpliceSlot[]): S {
  return updateEffect(section, effectId, (e) =>
    SLOTTED.has(e.generator.kind) ? { ...e, generator: { ...e.generator, slots: cloneJson(slots) } } : null,
  );
}

// ---- Modifiers (an Effect's chain, or the section master) --------------------------------

function chainOf(section: EffectsSection, owner: ChainOwner): ModifierDevice[] | undefined {
  return owner === MASTER_CELL ? section.master : effectById(section, owner)?.modifiers;
}

/** Replace the owner's chain via `edit` (null / same array = no-op), validating every device. */
function updateChain<S extends EffectsSection>(
  section: S,
  owner: ChainOwner,
  edit: (chain: ModifierDevice[]) => ModifierDevice[] | null,
): S {
  const chain = chainOf(section, owner);
  if (!chain) return section;
  const next = edit(chain);
  if (!next || next === chain) return section;
  const parsed: ModifierDevice[] = [];
  for (const device of next) {
    const result = effectChain.modifierDeviceSchema.safeParse(device);
    if (!result.success) return section;
    parsed.push(result.data);
  }
  if (owner === MASTER_CELL) return { ...section, master: parsed };
  return updateEffect(section, owner, (e) => ({ ...e, modifiers: parsed }));
}

function updateModifier<S extends EffectsSection>(
  section: S,
  owner: ChainOwner,
  uid: string,
  edit: (m: ModifierDevice) => ModifierDevice | null,
): S {
  return updateChain(section, owner, (chain) => {
    const index = chain.findIndex((m) => m.uid === uid);
    if (index < 0) return null;
    const next = edit(chain[index]!);
    if (!next) return null;
    return chain.map((m, i) => (i === index ? next : m));
  });
}

/** Insert a Modifier (registry id) at `index` (default: the end of the chain). */
export function addModifier<S extends EffectsSection>(section: S, owner: ChainOwner, modifierId: string, index?: number): Minted<S> {
  const chain = chainOf(section, owner);
  if (!chain || !tryGetModifier(modifierId)) return { section, id: null };
  const uid = freshId('mod', (id) => chain.some((m) => m.uid === id));
  const device = effectChain.modifierDeviceSchema.parse({ uid, modifierId });
  const at = index == null ? chain.length : Math.max(0, Math.min(Math.trunc(index), chain.length));
  const next = updateChain(section, owner, (c) => [...c.slice(0, at), device, ...c.slice(at)]);
  return next === section ? { section, id: null } : { section: next, id: uid };
}

/** Remove a Modifier; an Effect's control mappings that drove it are removed with it. */
export function removeModifier<S extends EffectsSection>(section: S, owner: ChainOwner, uid: string): S {
  const next = updateChain(section, owner, (chain) => (chain.some((m) => m.uid === uid) ? chain.filter((m) => m.uid !== uid) : null));
  if (next === section || owner === MASTER_CELL) return next;
  return updateEffect(next, owner, (e) => {
    if (!e.controls.some((c) => c.mappings.some((m) => m.device === uid))) return null;
    return { ...e, controls: e.controls.map((c) => ({ ...c, mappings: c.mappings.filter((m) => m.device !== uid) })) };
  });
}

export function moveModifier<S extends EffectsSection>(section: S, owner: ChainOwner, uid: string, index: number): S {
  return updateChain(section, owner, (chain) => {
    const from = chain.findIndex((m) => m.uid === uid);
    if (from < 0) return null;
    const to = Math.max(0, Math.min(Math.trunc(index), chain.length - 1));
    if (to === from) return null;
    const next = [...chain];
    const [device] = next.splice(from, 1);
    next.splice(to, 0, device!);
    return next;
  });
}

export function setModifierParam<S extends EffectsSection>(section: S, owner: ChainOwner, uid: string, key: string, value: ParamValue): S {
  return updateModifier(section, owner, uid, (m) => (m.params[key] === value ? null : { ...m, params: { ...m.params, [key]: value } }));
}

/** Several params of one modifier in one edit; `undefined` removes a param (a beats companion). */
export function setModifierParams<S extends EffectsSection>(
  section: S,
  owner: ChainOwner,
  uid: string,
  patch: Readonly<Record<string, ParamValue | undefined>>,
): S {
  return updateModifier(section, owner, uid, (m) => {
    const params: Record<string, ParamValue> = { ...m.params };
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        if (key in params) {
          delete params[key];
          changed = true;
        }
      } else if (params[key] !== value) {
        params[key] = value;
        changed = true;
      }
    }
    return changed ? { ...m, params } : null;
  });
}

/** Mix is clamped to 0..1. */
export function setModifierMix<S extends EffectsSection>(section: S, owner: ChainOwner, uid: string, mix: number): S {
  if (!Number.isFinite(mix)) return section;
  const clamped = Math.max(0, Math.min(1, mix));
  return updateModifier(section, owner, uid, (m) => (m.mix === clamped ? null : { ...m, mix: clamped }));
}

/** `null` removes the per-modifier envelope. */
export function setModifierEnvelope<S extends EffectsSection>(
  section: S,
  owner: ChainOwner,
  uid: string,
  envelope: ModifierEnvelopeSpec | null,
): S {
  return updateModifier(section, owner, uid, (m) => {
    if (envelope === null) {
      if (!m.envelope) return null;
      const { envelope: _drop, ...rest } = m;
      return rest as ModifierDevice;
    }
    return JSON.stringify(envelope) === JSON.stringify(m.envelope) ? null : { ...m, envelope: cloneJson(envelope) };
  });
}

export function setModifierBypass<S extends EffectsSection>(section: S, owner: ChainOwner, uid: string, bypass: boolean): S {
  return updateModifier(section, owner, uid, (m) => (m.bypass === bypass ? null : { ...m, bypass }));
}

// ---- Controls ---------------------------------------------------------------------------

function updateControl<S extends EffectsSection>(
  section: S,
  effectId: string,
  uid: string,
  edit: (c: ControlDevice) => unknown,
): S {
  return updateEffect(section, effectId, (e) => {
    const index = e.controls.findIndex((c) => c.uid === uid);
    if (index < 0) return null;
    const current = e.controls[index]!;
    const edited = edit(current);
    if (edited == null || edited === current) return null;
    const parsed = effectChain.controlDeviceSchema.safeParse(edited);
    if (!parsed.success) return null;
    return { ...e, controls: e.controls.map((c, i) => (i === index ? parsed.data : c)) };
  });
}

export function addControl<S extends EffectsSection>(section: S, effectId: string, kind: ControlKind): Minted<S> {
  const effect = effectById(section, effectId);
  if (!effect) return { section, id: null };
  const uid = freshId('ctl', (id) => effect.controls.some((c) => c.uid === id));
  const parsed = effectChain.controlDeviceSchema.safeParse({ uid, kind });
  if (!parsed.success) return { section, id: null };
  const next = updateEffect(section, effectId, (e) => ({ ...e, controls: [...e.controls, parsed.data] }));
  return next === section ? { section, id: null } : { section: next, id: uid };
}

export function removeControl<S extends EffectsSection>(section: S, effectId: string, uid: string): S {
  return updateEffect(section, effectId, (e) =>
    e.controls.some((c) => c.uid === uid) ? { ...e, controls: e.controls.filter((c) => c.uid !== uid) } : null,
  );
}

/** Merge settings into the control's; an invalid result (out-of-range value) is refused. */
export function setControlSettings<S extends EffectsSection>(
  section: S,
  effectId: string,
  uid: string,
  settings: Partial<ControlDevice['settings']>,
): S {
  return updateControl(section, effectId, uid, (c) => {
    const merged = { ...c.settings, ...settings };
    return JSON.stringify(merged) === JSON.stringify(c.settings) ? null : { ...c, settings: merged };
  });
}

export function addMapping<S extends EffectsSection>(section: S, effectId: string, controlUid: string, mapping: ControlMapping): S {
  return updateControl(section, effectId, controlUid, (c) => ({ ...c, mappings: [...c.mappings, cloneJson(mapping)] }));
}

export function setMapping<S extends EffectsSection>(
  section: S,
  effectId: string,
  controlUid: string,
  index: number,
  mapping: Partial<ControlMapping>,
): S {
  return updateControl(section, effectId, controlUid, (c) => {
    const current = c.mappings[index];
    if (!current) return null;
    const merged = { ...current, ...mapping };
    if (JSON.stringify(merged) === JSON.stringify(current)) return null;
    return { ...c, mappings: c.mappings.map((m, i) => (i === index ? merged : m)) };
  });
}

export function removeMapping<S extends EffectsSection>(section: S, effectId: string, controlUid: string, index: number): S {
  return updateControl(section, effectId, controlUid, (c) =>
    index >= 0 && index < c.mappings.length ? { ...c, mappings: c.mappings.filter((_, i) => i !== index) } : null,
  );
}

// ---- Pasting devices -----------------------------------------------------------------------

/** Insert a COPY of a Modifier device (fresh uid) at `index` of a chain (default: the end). */
export function insertModifierDevice<S extends EffectsSection>(section: S, owner: ChainOwner, device: ModifierDevice, index?: number): Minted<S> {
  const chain = chainOf(section, owner);
  if (!chain) return { section, id: null };
  const uid = freshId('mod', (id) => chain.some((m) => m.uid === id));
  const copy: ModifierDevice = { ...cloneJson(device), uid };
  const at = index == null ? chain.length : Math.max(0, Math.min(Math.trunc(index), chain.length));
  const next = updateChain(section, owner, (c) => [...c.slice(0, at), copy, ...c.slice(at)]);
  return next === section ? { section, id: null } : { section: next, id: uid };
}

/**
 * Add a COPY of a Control device (fresh uid) to an Effect. A mapping names a device of the Effect
 * it came from, so it survives only where that device still exists: the Generator, when the
 * destination's Generator is the same kind (`sourceGenerator`), and a Modifier uid present in the
 * destination (true when pasting back into the same Effect). The rest are left off and counted.
 */
export function insertControlDevice<S extends EffectsSection>(
  section: S,
  effectId: string,
  device: ControlDevice,
  sourceGenerator: string,
): Minted<S> & { dropped: number } {
  const effect = effectById(section, effectId);
  if (!effect) return { section, id: null, dropped: 0 };
  const uid = freshId('ctl', (id) => effect.controls.some((c) => c.uid === id));
  const keeps = (device: string): boolean =>
    device === 'generator' ? effect.generator.kind === sourceGenerator : effect.modifiers.some((m) => m.uid === device);
  const mappings = device.mappings.filter((m) => keeps(m.device));
  const copy: ControlDevice = { ...cloneJson(device), uid, mappings: cloneJson(mappings) };
  const next = updateEffect(section, effectId, (e) => ({ ...e, controls: [...e.controls, copy] }));
  return next === section ? { section, id: null, dropped: 0 } : { section: next, id: uid, dropped: device.mappings.length - mappings.length };
}

// ---- Cells ------------------------------------------------------------------------------

/** A deep copy of the cell's stack — the cell clipboard's payload. */
export function copyCell(section: EffectsSection, cell: EffectCell): Effect[] {
  return cloneJson(cellEffects(section, cell));
}

/**
 * Paste a stack into `cell`: fresh Effect ids, re-homed to the cell (trigger / default Target
 * follow it), appended on top of the cell's stack in their copied order. Refused (nothing
 * applied) when the stack is empty or any Effect cannot live in the cell.
 */
export function pasteCell<S extends EffectsSection>(section: S, cell: EffectCell, stack: readonly Effect[]): { section: S; result: ApplyResult } {
  if (stack.length === 0) return { section, result: { ok: false, reason: 'Nothing to paste.' } };
  const taken = new Set<string>();
  const pasted: Effect[] = [];
  for (const source of stack) {
    const id = freshEffectId(section, taken);
    taken.add(id);
    const moved = relocate({ ...cloneJson(source), id }, cell);
    if (!moved) return { section, result: { ok: false, reason: 'These Effects cannot be placed in this cell.' } };
    pasted.push(moved);
  }
  return { section: withEffects(section, [...section.effects, ...pasted]), result: { ok: true } };
}

export function clearCell<S extends EffectsSection>(section: S, cell: EffectCell): S {
  if (!section.effects.some((e) => sameCell(e.cell, cell))) return section;
  const cleared = withEffects(section, section.effects.filter((e) => !sameCell(e.cell, cell)));
  // An emptied cell starts over: it layers again, with no reset.
  return section.cellPlay?.some((p) => sameCell(p.cell, cell))
    ? { ...cleared, cellPlay: section.cellPlay.filter((p) => !sameCell(p.cell, cell)) }
    : cleared;
}

// ---- Cell play (Layer / Sequence / Random) -----------------------------------------------

/**
 * Set how a cell's stack plays a hit. `layer` removes the entry (the default needs none). Switching
 * between Sequence and Random keeps the reset. An Always cell has no hits to answer: refused.
 */
export function setCellPlayMode<S extends EffectsSection>(section: S, cell: EffectCell, mode: effectChain.CellPlayMode): S {
  if (cell.column.kind === 'always') return section;
  const entries = section.cellPlay ?? [];
  const current = entries.find((p) => sameCell(p.cell, cell));
  if ((current?.mode ?? 'layer') === mode) return section;
  const rest = entries.filter((p) => !sameCell(p.cell, cell));
  const next = mode === 'layer'
    ? rest
    : [...rest, { cell: cloneJson(cell), mode, ...(current?.reset ? { reset: cloneJson(current.reset) } : {}) }];
  return { ...section, cellPlay: next };
}

/** Set (or, with null, clear) the input that rewinds a Sequence / Random cell. No-op on a layering cell. */
export function setCellReset<S extends EffectsSection>(section: S, cell: EffectCell, reset: effectChain.CellReset | null): S {
  const entries = section.cellPlay ?? [];
  const index = entries.findIndex((p) => sameCell(p.cell, cell));
  if (index < 0) return section;
  const current = entries[index]!;
  if (reset !== null && !effectChain.cellResetSchema.safeParse(reset).success) return section;
  if (JSON.stringify(current.reset ?? null) === JSON.stringify(reset)) return section;
  const { reset: _old, ...base } = current;
  const updated: effectChain.CellPlay = reset === null ? base : { ...base, reset: cloneJson(reset) };
  return { ...section, cellPlay: entries.map((p, i) => (i === index ? updated : p)) };
}
