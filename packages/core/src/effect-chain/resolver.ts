/**
 * THE seam between the authored Effect model and the voice engine. Two jobs, both pure:
 *
 * 1. **Matching** — which of a section's Effects fire for an input (zone / cue), on section
 *    recall (Always), or on a transport beat-grid crossing (Clock). Results keep section
 *    order, which is the composition order; bypassed Effects never match.
 * 2. **Resolution** — turn one Effect plus its fire context into the existing
 *    {@link PlayAction} the voice pool already spawns, so envelopes, the generator bridge,
 *    the modifier chain and the compositor run unchanged beneath it.
 *
 * The server engine, the offline sim and show assembly all go through here, so they cannot
 * disagree about what an Effect does.
 */
import { tryGetEffect } from '../effects/registry';
import { tryGetModifier } from '../modifiers/registry';
import type { ResolvedModifier } from '../modifiers/types';
import { canvasEffectId } from '../canvas/ids';
import type { CurveValue } from '../model/curve';
import { defaultEnvelope } from '../voice/envelope';
import type { PlayAction } from '../voice/play-action';
import { applyModulations, quantizeSteppedRandom, sampleRandomDistribution, type Mapping, type ModParamSpec, type ModSource } from '../voice/modulation';
import type { ParamValues, PlayMode, Scope } from '../voice/types';
import { resolveGenerator } from './generators';
import { CHAIN_BUS_ID, chainEffectDefId } from './runtime';
import { EFFECT_DEVICE, EFFECT_TARGETS, FIRE_TIME_CONTROLS, KIT_ROW, type AmpEnvelope, type ControlDevice, type Effect, type EffectCell, type EffectTarget, type GeneratorDevice } from './types';
import { resolveTempoParams } from './tempo';
import type { EffectGenerator } from '../effects/types';
import { isContinuousTarget, type InputMapping } from './input-mappings';

/** The authored slice of a section the resolver reads. */
export interface EffectSectionLike {
  effects?: readonly Effect[];
}

/**
 * One input, in the terms Effects match on. A single physical message can carry several
 * facets — a zone-mapped MIDI note has a `drumId`/`slot` AND a `midiNote` — and every facet
 * that matches fires: zone Effects and Cue Effects on the same note BOTH fire, in section
 * order.
 */
export interface EffectInputEvent {
  drumId?: string;
  slot?: number;
  midiNote?: number;
  midiCc?: number;
  oscAddress?: string;
}

/** Effects of `section` that the input fires, in section order, bypassed excluded. */
export function matchSectionEffects(section: EffectSectionLike, event: EffectInputEvent): Effect[] {
  const out: Effect[] = [];
  for (const effect of section.effects ?? []) {
    if (effect.bypass) continue;
    if (matchesInput(effect, event)) out.push(effect);
  }
  return out;
}

function matchesInput(effect: Effect, event: EffectInputEvent): boolean {
  const { cell, trigger } = effect;
  if (trigger.kind === 'zone') {
    return cell.column.kind === 'zone'
      && event.drumId !== undefined
      && cell.row === event.drumId
      && event.slot !== undefined
      && cell.column.slot === event.slot;
  }
  if (trigger.kind === 'cue') {
    const src = trigger.source;
    return (src.midiNote !== undefined && src.midiNote === event.midiNote)
      || (src.midiCc !== undefined && src.midiCc === event.midiCc)
      || (src.oscAddress !== undefined && src.oscAddress === event.oscAddress);
  }
  return false;
}

/** Is `cell` the same grid cell as `other` (row + column kind, and the slot for a zone)? */
export function sameEffectCell(cell: EffectCell, other: EffectCell): boolean {
  if (cell.row !== other.row || cell.column.kind !== other.column.kind) return false;
  return cell.column.kind !== 'zone' || (other.column.kind === 'zone' && cell.column.slot === other.column.slot);
}

/** The Effects stacked in `cell` of `section` (a `fireCell` mapping), in section order,
    bypassed excluded. */
export function cellEffects(section: EffectSectionLike, cell: EffectCell): Effect[] {
  return (section.effects ?? []).filter((e) => !e.bypass && sameEffectCell(e.cell, cell));
}

/** Always Effects of `section`, in section order, bypassed excluded. */
export function alwaysEffects(section: EffectSectionLike): Effect[] {
  return (section.effects ?? []).filter((e) => !e.bypass && e.trigger.kind === 'always');
}

/**
 * Clock Effects whose beat grid the transport crossed moving from `prevBeat` to `beat`: a grid
 * point `g = offsetBeats + k·period` fires when `prevBeat < g ≤ beat`. At most one fire per
 * Effect per call, so a transport jump cannot burst a backlog of fires. A backwards or
 * stationary transport crosses nothing.
 */
export function clockEffectsCrossed(
  section: EffectSectionLike,
  prevBeat: number,
  beat: number,
  beatsPerBar = 4,
): Effect[] {
  if (!(beat > prevBeat)) return [];
  const out: Effect[] = [];
  for (const effect of section.effects ?? []) {
    const t = effect.trigger;
    if (effect.bypass || t.kind !== 'clock') continue;
    const period = 'beats' in t.every ? t.every.beats : t.every.bars * (beatsPerBar > 0 ? beatsPerBar : 4);
    if (!(period > 0)) continue;
    const before = Math.floor((prevBeat - t.offsetBeats) / period);
    const after = Math.floor((beat - t.offsetBeats) / period);
    if (after > before) out.push(effect);
  }
  return out;
}

// ---- Resolution --------------------------------------------------------------------

/** Everything about one fire the resolution needs beyond the Effect itself. */
export interface EffectFireCtx {
  /** Normalised 0..1 fire velocity. */
  velocity: number;
  /** The drum that was struck, when the fire came from a hit. */
  sourceDrumId: string | null;
  bpm: number;
  /** The Effect's index in its section's `effects` (composition order). */
  layerOrder: number;
  /** Seeded source for Random controls. Absent → every Random control reads 0. */
  rng?: { next(): number };
}

const MS_PER_MINUTE = 60000;

/**
 * Resolve one Effect into the {@link PlayAction} the voice pool spawns, or `null` when its
 * Generator (kind or Style) is unknown — the caller skips the Effect and reports it.
 *
 * - **Generator** → the hosted effect id (through the internal chain EffectDef) and params
 *   (spec defaults ← Style params ← device params).
 * - **Modifiers** → `ResolvedModifier[]` in chain order, bypass preserved, `mix` / `envelope`
 *   carried for the chain runner.
 * - **Controls** → `Mapping[]` on the generator params and per-modifier `modulations`; a
 *   mapping's range defaults to the target param spec range. Mappings naming a device that is
 *   not in this Effect are dropped.
 * - **Amp envelope** → attack (and its curve) / sustain / release, the play mode, and always an
 *   amplitude-over-life curve (flat at 1 when the sustain level is 1). Emitting the curve
 *   unconditionally makes the amp envelope the sole owner of the level: a hosted generator's
 *   own decay is always off on this path, whatever the sustain level.
 * - **Target** → scope / targetId, or an explicit `targets` list for chosen drums and hoops.
 */
export function effectPlayAction(effect: Effect, ctx: EffectFireCtx): PlayAction | null {
  const resolved = hostedGenerator(effect);
  if (!resolved) return null;
  const { gen, hostedId, hosted } = resolved;

  const params: ParamValues = {};
  for (const spec of hosted.paramSpec) params[spec.key] = spec.default as ParamValues[string];
  Object.assign(params, gen.params);

  const modifiers: ResolvedModifier[] = effect.modifiers.map((m) => {
    const link: ResolvedModifier = { modifierId: m.modifierId, params: { ...m.params }, mix: m.mix };
    if (m.bypass) link.bypass = true;
    if (m.envelope) {
      // A stage in beats resolves at this fire's tempo; otherwise its ms stand.
      const beat = MS_PER_MINUTE / (ctx.bpm > 0 ? ctx.bpm : 120);
      const { attackBeats, decayBeats, releaseBeats, ...env } = m.envelope;
      link.envelope = {
        ...env,
        attackMs: attackBeats !== undefined ? attackBeats * beat : env.attackMs,
        decayMs: decayBeats !== undefined ? decayBeats * beat : env.decayMs,
        releaseMs: releaseBeats !== undefined ? releaseBeats * beat : env.releaseMs,
      };
    }
    return link;
  });

  const generatorMappings: Mapping[] = [];
  // Mappings onto the Effect itself — Opacity and the envelope — set once, at this fire.
  const effectMappings: Mapping[] = [];
  for (const control of effect.controls) {
    const source = controlSource(control, ctx.rng);
    for (const mapping of control.mappings) {
      if (mapping.device === EFFECT_DEVICE) {
        if (!FIRE_TIME_CONTROLS.includes(control.kind)) continue;
        const m = toMapping(mapping, source, EFFECT_TARGETS);
        if (m) effectMappings.push(m);
        continue;
      }
      if (mapping.device === 'generator') {
        const m = toMapping(mapping, source, hosted.paramSpec);
        if (m) generatorMappings.push(m);
        continue;
      }
      const index = effect.modifiers.findIndex((d) => d.uid === mapping.device);
      if (index < 0) continue;
      const link = modifiers[index]!;
      const m = toMapping(mapping, source, tryGetModifier(link.modifierId)?.paramSpec ?? []);
      if (m) (link.modulations ??= []).push(m);
    }
  }

  const amp = effect.amp;
  const msPerBeat = MS_PER_MINUTE / (ctx.bpm > 0 ? ctx.bpm : 120);
  const length = resolveAmpLength(amp.length, hosted, params, ctx.bpm);
  // A stage in beats resolves at this fire's tempo; otherwise its milliseconds stand.
  const mode: PlayMode = effect.trigger.kind === 'always' || length === 'loop'
    ? 'loop'
    : length === 'hold' ? 'hold' : 'oneshot';
  // Then a Velocity (or Random) Control may move them for this hit.
  const fire = atFire(effectMappings, {
    opacity: effect.opacity,
    attack: amp.attackBeats !== undefined ? amp.attackBeats * msPerBeat : amp.attackMs,
    sustain: typeof length === 'object' ? ('ms' in length ? length.ms : length.beats * msPerBeat) : 0,
    decay: amp.releaseBeats !== undefined ? amp.releaseBeats * msPerBeat : amp.releaseMs,
  }, ctx);
  const attackMs = fire.attack;
  const releaseMs = fire.decay;
  const gateMs = typeof length === 'object' ? fire.sustain : 0;
  const shape = ampShape(attackMs, amp.decayMs, amp.sustainLevel);
  const attackEase = amp.attackEase && amp.attackEase.fn !== 'linear' ? { ...amp.attackEase } : undefined;
  const sustainMs = mode === 'oneshot' ? Math.max(0, gateMs - attackMs) : 0;

  const action: PlayAction = {
    kind: 'play',
    effectId: chainEffectDefId(hostedId),
    ...(gen.canvasScene ? { canvasScene: gen.canvasScene } : {}),
    // A Splice / Slice part that pulses or fades in its turn runs THE Effect's envelope (one
    // envelope per Effect); a held / looping Effect has no length, so a part keeps the splice hold.
    ...(gen.splice
      ? {
          splice: {
            ...gen.splice,
            envelope: { attackMs, sustainMs: mode === 'oneshot' ? sustainMs : gen.splice.envelope.sustainMs, releaseMs },
            attackEase,
          },
          spliceInputs: gen.spliceInputs ?? [],
        }
      : {}),
    mode,
    ...targetFields(effect, ctx.sourceDrumId),
    busId: CHAIN_BUS_ID,
    params,
    modifiers: modifiers.length ? modifiers : undefined,
    modulations: generatorMappings.length ? generatorMappings : undefined,
    attackMs,
    ...(attackEase ? { attackEase } : {}),
    sustainMs,
    releaseMs,
    chainEffectId: effect.id,
    blend: effect.blend,
    opacity: fire.opacity,
    layerOrder: ctx.layerOrder,
    via: `Effect: ${effect.name || effect.id}`,
    latchKey: null,
    lifeEnvelope: shape.curve,
    lifeSpanMs: shape.spanMs,
  };
  return action;
}

/**
 * Sustain "until it ends" (`auto`) as a concrete length: the hosted effect's content span at this
 * fire's tempo, `loop` when its content never ends on its own, or the default time when the effect
 * can't say. Every other length passes through.
 */
function resolveAmpLength(
  length: AmpEnvelope['length'],
  hosted: EffectGenerator,
  params: ParamValues,
  bpm: number,
): Exclude<AmpEnvelope['length'], 'auto'> {
  if (length !== 'auto') return length;
  if (!hosted.contentSpanMs) return { ms: 500 };
  const resolved: Record<string, number | string | boolean> = { ...params };
  resolveTempoParams(resolved, hosted.paramSpec, bpm > 0 ? bpm : 120);
  const span = hosted.contentSpanMs(resolved);
  return span === null ? 'loop' : { ms: Math.max(0, span) };
}

/** Whether an Effect's Generator can play Sustain "until it ends" — its hosted effect says how
    long its content lasts (Dot). */
export function supportsAutoLength(device: GeneratorDevice): boolean {
  const gen = resolveGenerator(device);
  return !!gen && !gen.canvasScene && !!tryGetEffect(gen.effectId)?.contentSpanMs;
}

/**
 * The Effect's own Opacity, Attack, Sustain and Decay for this fire, after the Controls that drive
 * them (Velocity, Random) — the same rule as any mapping: from the setting towards its Min…Max by
 * the control's value, × Amount, kept in range.
 */
function atFire(
  mappings: readonly Mapping[],
  base: { opacity: number; attack: number; sustain: number; decay: number },
  ctx: EffectFireCtx,
): { opacity: number; attack: number; sustain: number; decay: number } {
  if (!mappings.length) return base;
  const out: ParamValues = { ...base };
  applyModulations({ ...base }, out, mappings, EFFECT_TARGETS, { phase: 0, timeMs: 0, bpm: ctx.bpm, velocity: ctx.velocity });
  const n = (k: keyof typeof base) => (typeof out[k] === 'number' ? (out[k] as number) : base[k]);
  return { opacity: n('opacity'), attack: n('attack'), sustain: n('sustain'), decay: n('decay') };
}

/** An Effect's Generator resolved to the hosted effect implementation it plays, or `null`. */
function hostedGenerator(effect: Effect) {
  const gen = resolveGenerator(effect.generator);
  if (!gen) return null;
  const hostedId = gen.canvasScene ? canvasEffectId(gen.canvasScene) : gen.effectId;
  const hosted = tryGetEffect(hostedId);
  return hosted ? { gen, hostedId, hosted } : null;
}

/** The drum a `hitDrum` target (or a Kit-row fire) lights: the struck drum, else the row's. */
function effectiveDrum(effect: Effect, sourceDrumId: string | null): string | null {
  if (sourceDrumId) return sourceDrumId;
  return effect.cell.row === KIT_ROW ? null : effect.cell.row;
}

function targetFields(effect: Effect, sourceDrumId: string | null): { scope: Scope; targetId?: string; targets?: string[] } {
  const target: EffectTarget = effect.target;
  switch (target.kind) {
    case 'kit':
      return { scope: 'kit' };
    case 'hitDrum': {
      const drum = effectiveDrum(effect, sourceDrumId);
      return drum ? { scope: 'drum', targetId: drum } : { scope: 'kit' };
    }
    case 'select':
      return {
        scope: 'kit',
        targets: target.drums.map((d) => (d.hoops?.length ? `${d.drumId}#${d.hoops.join(',')}` : d.drumId)),
      };
  }
}

/**
 * The decay-to-sustain part of the amp envelope as an amplitude-over-life curve. The curve
 * holds 1 through the attack, falls linearly to the sustain level over the decay, then stays
 * flat; its x axis spans `attack + decay` ms. At sustain level 1 it is flat at 1 — still
 * emitted, because a present curve is what switches the hosted generator's natural decay off
 * (`authoredDecay`), so the look does not jump between sustain 1 and 0.999.
 */
function ampShape(attackMs: number, decayMs: number, sustainLevel: number): { curve: CurveValue; spanMs: number } {
  if (sustainLevel >= 1) {
    return { curve: { h0: { x: 0, y: 1 }, h1: { x: 1, y: 1 }, profile: 'bend', strength: 0 }, spanMs: Math.max(1, attackMs + decayMs) };
  }
  const decay = Math.max(1, decayMs);
  const spanMs = attackMs + decay;
  return {
    curve: { h0: { x: attackMs / spanMs, y: 1 }, h1: { x: 1, y: sustainLevel }, profile: 'bend', strength: 0 },
    spanMs,
  };
}

function controlSource(control: ControlDevice, rng: EffectFireCtx['rng']): ModSource {
  switch (control.kind) {
    case 'envelope':
      return {
        kind: 'envelope',
        env: control.settings.points?.length
          ? { kind: 'custom', amount: 1, points: control.settings.points.map((p) => ({ ...p })) }
          : defaultEnvelope('decay'),
      };
    case 'lfo':
      return { kind: 'lfo', lfo: { ...control.settings } };
    case 'velocity':
      return { kind: 'velocity' };
    case 'random': {
      // Frozen at the fire: each fire draws once per control.
      const { distribution, steps } = control.settings;
      const raw = rng ? sampleRandomDistribution(distribution, rng) : 0;
      const value = distribution === 'stepped' ? quantizeSteppedRandom(raw, steps) : raw;
      return { kind: 'random', value, distribution, steps };
    }
    case 'cc':
      return { kind: 'cc', controller: control.settings.controller, channel: control.settings.channel };
    case 'osc':
      return { kind: 'osc', address: control.settings.address };
    case 'note':
      return { kind: 'note', ...control.settings };
    case 'audio':
      return { kind: 'audio', band: control.settings.band };
  }
}

function toMapping(
  mapping: ControlDevice['mappings'][number],
  source: ModSource,
  specs: readonly ModParamSpec[],
): Mapping | null {
  const spec = specs.find((s) => s.key === mapping.param);
  if (spec && (spec.kind ?? spec.type) !== 'number') return null;
  return {
    targetParam: mapping.param,
    source,
    amount: mapping.amount,
    invert: mapping.invert,
    rangeMin: mapping.rangeMin ?? spec?.min ?? 0,
    rangeMax: mapping.rangeMax ?? spec?.max ?? 1,
  };
}

// ---- Continuous input mappings (MIDI-map, effect chains wave 5) -----------------------------

/**
 * Where a continuous {@link InputMapping} writes on a live voice of its Effect:
 *
 * - `generator` — `voice.params[param]`;
 * - `modifier`  — `voice.modifiers[modifierIndex].params[param]`;
 * - `opacity`   — `voice.opacity` (the Effect layer's opacity);
 * - `mix`       — `voice.modifiers[modifierIndex].mix`.
 */
export type ContinuousInputSlot = 'generator' | 'modifier' | 'opacity' | 'mix';

/**
 * A continuous mapping resolved against one section's Effect, ready for the engine's per-frame
 * write. `rangeMin` / `rangeMax` default to the target's own range; `lo` / `hi` is that range,
 * the clamp every written value obeys.
 */
export interface ContinuousInputBinding {
  mappingId: string;
  effectId: string;
  slot: ContinuousInputSlot;
  /** The modifier's index in the Effect's chain (== the voice's `modifiers` index); -1 otherwise. */
  modifierIndex: number;
  /** The param key for `generator` / `modifier`; empty for `opacity` / `mix`. */
  param: string;
  rangeMin: number;
  rangeMax: number;
  lo: number;
  hi: number;
}

/**
 * Resolve every continuous mapping (`param`, `opacity`, `modifierMix`) whose Effect is in
 * `section`. A mapping is left out when its Effect, modifier or param is not there, or the
 * param is not a number. The engine re-resolves on every show load and section recall, so a
 * mapping always follows the ACTIVE section's authored Effect.
 */
export function resolveContinuousInputMappings(
  mappings: readonly InputMapping[],
  section: EffectSectionLike | null,
): ContinuousInputBinding[] {
  const out: ContinuousInputBinding[] = [];
  if (!section?.effects?.length) return out;
  for (const mapping of mappings) {
    const target = mapping.target;
    if (!isContinuousTarget(target) || !('effectId' in target)) continue;
    const effect = section.effects.find((e) => e.id === target.effectId);
    if (!effect) continue;
    const bind = (slot: ContinuousInputSlot, modifierIndex: number, param: string, lo: number, hi: number): void => {
      out.push({
        mappingId: mapping.id, effectId: effect.id, slot, modifierIndex, param,
        rangeMin: mapping.rangeMin ?? lo, rangeMax: mapping.rangeMax ?? hi, lo, hi,
      });
    };
    if (target.kind === 'opacity') {
      bind('opacity', -1, '', 0, 1);
      continue;
    }
    if (target.kind === 'modifierMix') {
      const index = effect.modifiers.findIndex((m) => m.uid === target.modifierUid);
      if (index >= 0) bind('mix', index, '', 0, 1);
      continue;
    }
    if (target.kind !== 'param') continue;
    if (target.device === 'generator') {
      const spec = hostedGenerator(effect)?.hosted.paramSpec.find((s) => s.key === target.param);
      if (spec?.type === 'number') bind('generator', -1, spec.key, spec.min ?? 0, spec.max ?? 1);
      continue;
    }
    const index = effect.modifiers.findIndex((m) => m.uid === target.device);
    if (index < 0) continue;
    const spec = tryGetModifier(effect.modifiers[index]!.modifierId)?.paramSpec.find((s) => s.key === target.param);
    if (spec?.type === 'number') bind('modifier', index, spec.key, spec.min ?? 0, spec.max ?? 1);
  }
  return out;
}
