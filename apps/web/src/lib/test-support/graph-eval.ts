/**
 * Evaluate a web-authored trigger graph through the ENGINE's evaluator.
 *
 * The suites that pin web-side graph semantics (value-switch routing, the velocity→value fold,
 * output gating, cascading Scope) used to drive the browser-side `Sim` and read the voices it
 * spawned. INIT-01 Decision 3 retired that sim; the semantics did not move, because the sim only
 * ever delegated to `voice.evalGraph`. This harness calls that evaluator directly, so the
 * assertions now run against the SAME code path the server engine runs — a stronger claim than
 * the mirror ever supported, with no second implementation to keep in step.
 *
 * Legacy (pre-Gen3) graphs are normalized first, exactly as the engine does at `setShow`.
 */
import { voice } from '@ledrums/core';
import { PRESETS } from '../trigger-lab/fixtures';
import type { TriggerCtx, TriggerGraph } from '../trigger-lab/sim';

/** The default trigger context: mid-section, 120bpm, kick as the source drum. */
function evalCtx(overrides: Partial<TriggerCtx> = {}): TriggerCtx {
  return { velocity: 1, sectionIndex: 0, sectionCount: 3, beatPhase: 0, sourceDrumId: 'kick', bpm: 120, ...overrides };
}

/** A fresh evaluator state over the fixture presets — one per evaluation, so sequence/latch
    bookkeeping never leaks between assertions. Seeded PRNG: identical inputs replay exactly. */
function evalState(): voice.EvalState {
  return {
    seqIndex: new Map(),
    lastPick: new Map(),
    latched: new Map(),
    prng: new voice.Prng(0x1a2b3c4d),
    presetsById: new Map(PRESETS.map((p) => [p.id, p])),
    isVoiceAlive: () => false,
  };
}

/** Every action a hit on `graph` produces, through the engine's evaluator. */
function evalActions(graph: TriggerGraph, ctx: Partial<TriggerCtx> = {}): voice.Action[] {
  const g = graph.version === 3 ? graph : voice.normalizeTriggerGraphToGen3(graph).graph;
  return voice.evalGraph(evalState(), g, 'preview', evalCtx(ctx));
}

/** Just the play actions — what would become sounding voices. */
export function evalPlays(graph: TriggerGraph, ctx: Partial<TriggerCtx> = {}): voice.PlayAction[] {
  return evalActions(graph, ctx).filter((a): a is voice.PlayAction => a.kind === 'play');
}

/** The effect ids a hit spawns, in evaluation order (the readable form for routing assertions). */
export function firedEffectIds(graph: TriggerGraph, ctx: Partial<TriggerCtx> = {}): string[] {
  return evalPlays(graph, ctx).map((a) => a.effectId);
}
