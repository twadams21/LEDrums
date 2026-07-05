/* Throwaway seed data: effects (with parameters), named presets, an abstract kit,
   and trigger trees chosen to show every block type. */

import {
  DEFAULT_KIT,
  collectionOf,
  listEffects,
  type EffectCategory,
  type ParamSpec as CoreParamSpec,
} from '@ledrums/core';
import {
  defaultParams,
  type Block,
  type Bus,
  type EffectDef,
  type ParamSpec,
  type PlayMode,
  type Preset,
  type Scope,
  type Section,
} from './sim';

export interface Pad {
  drumId: string;
  drumLabel: string;
  zone: number;
  zoneLabel: string;
  tree: Block;
}

export const ZONE_LABELS = ['center', 'edge', 'rim', 'shell'];

export const BUSES: Bus[] = [
  { id: 'base', name: 'Base', polyphony: 'mono', crossfadeMs: 900 },
  { id: 'trigger', name: 'Trigger', polyphony: 'poly', crossfadeMs: 240 },
  { id: 'effect', name: 'Effect', polyphony: 'mono', crossfadeMs: 600 },
];

// ---- param spec builders ----------------------------------------------------
const hueP = (def: number): ParamSpec => ({ key: 'hue', label: 'Hue', kind: 'number', min: 0, max: 360, step: 1, unit: '°', default: def, envable: true });
const briP: ParamSpec = { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, step: 0.05, default: 1, envable: true };
const speedP: ParamSpec = { key: 'speed', label: 'Speed', kind: 'number', min: 0.1, max: 3, step: 0.1, default: 1, envable: true };
const syncP: ParamSpec = { key: 'tempoSync', label: 'Tempo sync', kind: 'bool', default: false };
const bandsP = (def: number): ParamSpec => ({ key: 'bands', label: 'Bands', kind: 'number', min: 1, max: 8, step: 1, default: def, envable: true });
const angleP: ParamSpec = { key: 'angle', label: 'Angle', kind: 'number', min: 0, max: 360, step: 5, unit: '°', default: 0, envable: true };
const widthP: ParamSpec = { key: 'width', label: 'Width', kind: 'number', min: 0.04, max: 0.4, step: 0.01, default: 0.13, envable: true };
const densityP: ParamSpec = { key: 'density', label: 'Density', kind: 'number', min: 0.05, max: 1, step: 0.05, default: 0.3, envable: true };

/** Common parameters the effect creator offers to include on a new effect. */
export const PARAM_LIBRARY: ParamSpec[] = [hueP(200), briP, speedP, syncP, bandsP(3), angleP, widthP, densityP];

// The 10 hand-rolled per-pixel pattern effects were RETIRED in U3 (Effects Library v2):
// each was aliased onto its generator equivalent (core `aliases.ts`) and the whole legacy
// pattern render path was deleted. Old shows referencing the retired ids (`swirl`, `whole`,
// `chase`, …) resolve through the alias map at hydrate / buildShow. The seed PADS/SECTIONS
// below now reference the generator effects directly.

// ---- generator-backed effects ------------------------------------------------
// Each legacy `EffectGenerator` in core's registry is surfaced as a selectable
// EffectDef carrying `generatorId`; the compositor (server) and render.ts (offline)
// delegate rendering to it. Param specs are mapped from the generator's own spec;
// category drives the bus + envelope timing. See docs/prompts/port-all-effects.md.

/** Legacy category → voice bus. Backdrops on base, washes/utility/meter on effect,
    one-shot/particle hits on trigger. */
const CATEGORY_BUS: Record<EffectCategory, string> = {
  base: 'base',
  texture: 'base',
  wash: 'effect',
  meter: 'effect',
  utility: 'effect',
  particle: 'trigger',
  trigger: 'trigger',
};

/** Legacy category → default voice envelope (attack/sustain/release ms). Continuous
    fields get a slow attack/release; trigger/particle effects a fast one-shot shape. */
const CATEGORY_ENV: Record<EffectCategory, { attackMs: number; sustainMs: number; releaseMs: number }> = {
  base: { attackMs: 800, sustainMs: 0, releaseMs: 900 },
  texture: { attackMs: 800, sustainMs: 0, releaseMs: 900 },
  wash: { attackMs: 400, sustainMs: 0, releaseMs: 700 },
  meter: { attackMs: 80, sustainMs: 0, releaseMs: 250 },
  utility: { attackMs: 200, sustainMs: 0, releaseMs: 400 },
  particle: { attackMs: 10, sustainMs: 120, releaseMs: 500 },
  trigger: { attackMs: 10, sustainMs: 100, releaseMs: 300 },
};

/** Map a core ParamSpec → the lab's ParamSpec — TOTAL over all four `ParamType`s so
    no spec is ever silently dropped (S18). number/bool map 1:1 (numbers become
    envelope-able); `enum` maps to a Select (string value, its `options` carried through);
    `color` maps to a colour spec (a `'#rrggbb'` string) — its inspector control (the
    write-through swatch) is S19's, and no effect declares a color param yet. enum/color are
    not envelope-able. */
export function mapParamSpec(spec: CoreParamSpec): ParamSpec {
  if (spec.type === 'number') {
    return {
      key: spec.key,
      label: spec.label,
      kind: 'number',
      min: spec.min,
      max: spec.max,
      step: spec.step,
      unit: spec.unit,
      default: typeof spec.default === 'number' ? spec.default : 0,
      envable: true,
    };
  }
  if (spec.type === 'bool') {
    return { key: spec.key, label: spec.label, kind: 'bool', default: typeof spec.default === 'boolean' ? spec.default : false };
  }
  if (spec.type === 'enum') {
    const options = spec.options ?? [];
    return { key: spec.key, label: spec.label, kind: 'enum', options, default: typeof spec.default === 'string' ? spec.default : options[0] ?? '' };
  }
  return { key: spec.key, label: spec.label, kind: 'color', default: typeof spec.default === 'string' ? spec.default : '#ffffff' };
}

/** All core generators as selectable, generator-backed EffectDefs. Scope is `kit`
    for every one: generators own their spatial layout (drum-locality is intrinsic — e.g.
    whole-drum lights only the struck drum from its trigger), so drum-masking a kit-wide
    field (plasma, radial-wash) would wrongly clip it. */
export const GENERATOR_EFFECTS: EffectDef[] = listEffects().map((gen): EffectDef => {
  const env = CATEGORY_ENV[gen.category];
  return {
    id: `gen:${gen.id}`,
    name: gen.name,
    generatorId: gen.id,
    category: gen.category,
    description: gen.description,
    tags: gen.tags,
    playType: collectionOf(gen.tags),
    deprecated: gen.deprecated,
    busId: CATEGORY_BUS[gen.category],
    scope: 'kit',
    params: gen.paramSpec.map(mapParamSpec),
    attackMs: env.attackMs,
    sustainMs: env.sustainMs,
    releaseMs: env.releaseMs,
  };
});

/** The full selectable registry of REAL effects. Canvas cards are NOT listed here: the
    store derives virtual `canvas:<sceneId>` EffectDefs from the core built-in scene library
    plus the show's authored scenes (`store.canvasEffects`), so there is exactly one source
    of canvas cards and shows never persist duplicates of the built-ins (D4). */
export const EFFECTS: EffectDef[] = [...GENERATOR_EFFECTS];

const effectById = new Map(EFFECTS.map((e) => [e.id, e] as const));

export function effectScope(effectId: string): Scope {
  return effectById.get(effectId)?.scope ?? 'drum';
}

// ---- presets ----------------------------------------------------------------
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

function preset(effectId: string, name: string, overrides: Record<string, number | boolean | string> = {}): Preset {
  const eff = effectById.get(effectId)!;
  return { id: `${effectId}:${slug(name)}`, name, effectId, params: { ...defaultParams(eff), ...overrides } };
}

export const PRESETS: Preset[] = [
  // A Default preset for every selectable effect so play nodes resolve `${id}:default`.
  ...EFFECTS.map((e) => preset(e.id, 'Default')),
  // Burst merge (U3): its per-hit pop = a short-reach, fast-decay radial wash.
  preset('gen:radial-wash', 'Pop', { reach: 320, decayMs: 200, speed: 2.2, width: 300 }),
];

const presetById = new Map(PRESETS.map((p) => [p.id, p] as const));

let n = 0;
const bid = (k: string) => `${k}-${++n}`;

/** Build a fresh single-instance Play from an effect's Default preset. */
export const play = (effectId: string, mode: PlayMode = 'oneshot'): Block => {
  const eff = effectById.get(effectId)!;
  const presetId = `${effectId}:default`;
  const p = presetById.get(presetId);
  return {
    id: bid('play'),
    kind: 'play',
    mode,
    scope: eff.scope,
    effectId,
    presetId,
    params: { ...(p?.params ?? defaultParams(eff)) },
    env: {},
  };
};

// --- starter trees that exercise the block set ------------------------------

// Seed trees reference the generator effects (the retired pattern ids were remapped to
// their generator equivalents in U3 — see the alias map in core `aliases.ts`).
const kickCenter: Block = play('gen:whole-drum', 'oneshot');
const snareCenter: Block = { id: bid('rand'), kind: 'random', noRepeat: true, children: [play('gen:chase-bands'), play('gen:pixel-accum'), play('gen:ripple-3d')] };
const snareRim: Block = { id: bid('all'), kind: 'all', children: [play('gen:pixel-accum'), play('gen:strobe')] };
const tomCenter: Block = { id: bid('seq'), kind: 'sequence', children: [play('gen:chase-bands'), play('gen:ripple-3d'), play('gen:whole-drum')] };
// value+bands switch: 3 even bands (cutoffs 1/3, 2/3) == the old 3-child velocity split.
// treeToGraph wires the children onto band-0 / band-1 / band-2 in y-order.
const tomEdge: Block = {
  id: bid('switch'),
  kind: 'switch',
  on: 'value',
  valueMode: 'bands',
  bands: [1 / 3, 2 / 3],
  children: [play('gen:pixel-accum'), play('gen:chase-bands'), play('gen:whole-drum')],
};
const kickShell: Block = { id: bid('toggle'), kind: 'toggle', child: play('gen:lava-lamp', 'loop') };
const snareShell: Block = { id: bid('chance'), kind: 'chance', p: 0.5, child: play('gen:strobe') };
const tomRim: Block = {
  id: bid('rand2'),
  kind: 'random',
  noRepeat: false,
  children: [play('gen:radial-wash', 'loop'), { id: bid('all2'), kind: 'all', children: [play('gen:chase-bands'), play('gen:pixel-accum')] }],
};
const tom2Center: Block = { id: bid('seq2'), kind: 'sequence', children: [play('gen:ripple-3d'), play('gen:pixel-accum')] };
const tom2Rim: Block = { id: bid('chance2'), kind: 'chance', p: 0.7, child: play('gen:whole-drum') };

function pad(drumId: string, drumLabel: string, zone: number, tree: Block): Pad {
  return { drumId, drumLabel, zone, zoneLabel: ZONE_LABELS[zone]!, tree };
}

export const PADS: Pad[] = [
  pad('kick', 'Kick', 0, kickCenter),
  pad('kick', 'Kick', 3, kickShell),
  pad('snare', 'Snare', 0, snareCenter),
  pad('snare', 'Snare', 2, snareRim),
  pad('snare', 'Snare', 3, snareShell),
  pad('tom1', 'Tom 1', 0, tomCenter),
  pad('tom1', 'Tom 1', 1, tomEdge),
  pad('tom1', 'Tom 1', 2, tomRim),
  pad('tom2', 'Tom 2', 0, tom2Center),
  pad('tom2', 'Tom 2', 2, tom2Rim),
];

/** The drum roster, sourced from the canonical kit so ids/labels can't drift from
    the engine. PADS below reference these ids; the integrity check + a guard test
    fail loudly if a pad ever names a drum the canonical kit doesn't define. */
export const DRUMS = DEFAULT_KIT.drums.map((d) => ({ id: d.id, label: d.label }));

export const SECTIONS: Section[] = [
  { id: 'intro', name: 'Intro', looks: { base: 'gen:solid-base', trigger: null, effect: 'gen:radial-wash' } },
  { id: 'verse', name: 'Verse', looks: { base: 'gen:perlin-clouds', trigger: null, effect: null } },
  { id: 'chorus', name: 'Chorus', looks: { base: 'gen:plasma', trigger: null, effect: 'gen:radial-wash' } },
];
