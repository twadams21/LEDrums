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
import type { PlayAction } from '../voice/eval-graph';
import { quantizeSteppedRandom, sampleRandomDistribution, type Mapping, type ModParamSpec, type ModSource } from '../voice/modulation';
import type { ParamValues, PlayMode, Scope } from '../voice/types';
import { resolveGenerator } from './generators';
import { CHAIN_BUS_ID, chainEffectDefId } from './runtime';
import { KIT_ROW, type ControlDevice, type Effect, type EffectTarget } from './types';

/** The authored slice of a section the resolver reads. */
export interface EffectSectionLike {
  effects?: readonly Effect[];
}

/**
 * One input, in the terms Effects match on. A single physical message can carry several
 * facets — a zone-mapped MIDI note has a `drumId`/`slot` AND a `midiNote` — and every facet
 * that matches fires: zone Effects and Cue Effects on the same note BOTH fire, in section
 * order. That is today's precedence for graphs (a zone-mapped note fires its pad graphs and
 * any direct note-sourced graph alike).
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
 * - **Amp envelope** → attack / sustain / release, the play mode, and always an
 *   amplitude-over-life curve (flat at 1 when the sustain level is 1). Emitting the curve
 *   unconditionally makes the amp envelope the sole owner of the level: a hosted generator's
 *   own decay is always off on this path, whatever the sustain level.
 * - **Target** → scope / targetId, or an explicit `targets` list for chosen drums and hoops.
 */
export function effectPlayAction(effect: Effect, ctx: EffectFireCtx): PlayAction | null {
  const gen = resolveGenerator(effect.generator);
  if (!gen) return null;
  const hostedId = gen.canvasScene ? canvasEffectId(gen.canvasScene) : gen.effectId;
  const hosted = tryGetEffect(hostedId);
  if (!hosted) return null;

  const params: ParamValues = {};
  for (const spec of hosted.paramSpec) params[spec.key] = spec.default as ParamValues[string];
  Object.assign(params, gen.params);

  const modifiers: ResolvedModifier[] = effect.modifiers.map((m) => {
    const link: ResolvedModifier = { modifierId: m.modifierId, params: { ...m.params }, mix: m.mix };
    if (m.bypass) link.bypass = true;
    if (m.envelope) link.envelope = { ...m.envelope };
    return link;
  });

  const generatorMappings: Mapping[] = [];
  for (const control of effect.controls) {
    const source = controlSource(control, ctx.rng);
    for (const mapping of control.mappings) {
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
  const mode: PlayMode = effect.trigger.kind === 'always' || amp.length === 'loop'
    ? 'loop'
    : amp.length === 'hold' ? 'hold' : 'oneshot';
  const gateMs = typeof amp.length === 'object'
    ? 'ms' in amp.length ? amp.length.ms : amp.length.beats * (MS_PER_MINUTE / (ctx.bpm > 0 ? ctx.bpm : 120))
    : 0;
  const shape = ampShape(amp.attackMs, amp.decayMs, amp.sustainLevel);

  const action: PlayAction = {
    kind: 'play',
    effectId: chainEffectDefId(hostedId),
    ...(gen.canvasScene ? { canvasScene: gen.canvasScene } : {}),
    ...(gen.splice ? { splice: gen.splice, spliceInputs: gen.spliceInputs ?? [] } : {}),
    mode,
    ...targetFields(effect, ctx.sourceDrumId),
    busId: CHAIN_BUS_ID,
    params,
    modifiers: modifiers.length ? modifiers : undefined,
    modulations: generatorMappings.length ? generatorMappings : undefined,
    attackMs: amp.attackMs,
    sustainMs: mode === 'oneshot' ? Math.max(0, gateMs - amp.attackMs) : 0,
    releaseMs: amp.releaseMs,
    chainEffectId: effect.id,
    blend: effect.blend,
    opacity: effect.opacity,
    layerOrder: ctx.layerOrder,
    via: `Effect: ${effect.name || effect.id}`,
    latchKey: null,
    lifeEnvelope: shape.curve,
    lifeSpanMs: shape.spanMs,
  };
  return action;
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
      // Frozen at the fire, like a graph Random source: each fire draws once per control.
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
