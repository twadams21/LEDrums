/* Throwaway seed data: effects (with parameters), named presets, an abstract kit,
   and trigger trees chosen to show every block type. */

import {
  DEFAULT_KIT,
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

/** The original 10 hand-rolled per-pixel pattern effects (the lightweight fast path). */
export const PATTERN_EFFECTS: EffectDef[] = [
  { id: 'swirl', name: 'Swirl', pattern: 'swirl', busId: 'base', scope: 'kit', attackMs: 700, sustainMs: 0, releaseMs: 900, params: [hueP(245), briP, speedP, syncP, bandsP(2), angleP] },
  { id: 'aurora', name: 'Aurora', pattern: 'aurora', busId: 'base', scope: 'kit', attackMs: 900, sustainMs: 0, releaseMs: 900, params: [hueP(300), briP, speedP, syncP] },
  { id: 'drift', name: 'Drift', pattern: 'drift', busId: 'base', scope: 'kit', attackMs: 1100, sustainMs: 0, releaseMs: 1100, params: [hueP(205), briP, speedP, syncP] },

  { id: 'chase', name: 'Chase', pattern: 'chase', busId: 'trigger', scope: 'drum', attackMs: 20, sustainMs: 140, releaseMs: 260, params: [hueP(70), briP, speedP, syncP, widthP] },
  { id: 'whole', name: 'Whole Drum', pattern: 'flash', busId: 'trigger', scope: 'drum', attackMs: 10, sustainMs: 60, releaseMs: 300, params: [hueP(25), briP] },
  { id: 'sparkle', name: 'Sparkle', pattern: 'sparkle', busId: 'trigger', scope: 'drum', attackMs: 8, sustainMs: 40, releaseMs: 220, params: [hueP(128), briP, speedP, densityP] },
  { id: 'rip', name: 'Ripple', pattern: 'ripple', busId: 'trigger', scope: 'drum', attackMs: 30, sustainMs: 200, releaseMs: 400, params: [hueP(152), briP, speedP, bandsP(4)] },

  { id: 'wash', name: 'Radial Wash', pattern: 'radial', busId: 'effect', scope: 'kit', attackMs: 400, sustainMs: 0, releaseMs: 700, params: [hueP(330), briP, speedP, syncP] },
  { id: 'strobe', name: 'Strobe', pattern: 'strobe', busId: 'effect', scope: 'kit', attackMs: 4, sustainMs: 30, releaseMs: 120, params: [hueP(95), briP, speedP] },
  { id: 'haze', name: 'Haze', pattern: 'haze', busId: 'effect', scope: 'kit', attackMs: 800, sustainMs: 0, releaseMs: 1000, params: [hueP(230), briP, speedP] },
];

// ---- generator-backed effects (the 41 original engine effects) --------------
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

/** Map a legacy core ParamSpec → the lab's ParamSpec — TOTAL over all four `ParamType`s so
    no spec is ever silently dropped (S18). number/bool map 1:1 (numbers become
    envelope-able); `enum` maps to a Select (string value, its `options` carried through);
    `color` maps to a colour control (a `'#rrggbb'` string). enum/color are not envelope-able. */
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
    return {
      key: spec.key,
      label: spec.label,
      kind: 'bool',
      default: typeof spec.default === 'boolean' ? spec.default : false,
    };
  }
  if (spec.type === 'enum') {
    const options = spec.options ?? [];
    return {
      key: spec.key,
      label: spec.label,
      kind: 'enum',
      options,
      default: typeof spec.default === 'string' ? spec.default : options[0] ?? '',
    };
  }
  // color — a static-colour param carried as a '#rrggbb' string.
  return {
    key: spec.key,
    label: spec.label,
    kind: 'color',
    default: typeof spec.default === 'string' ? spec.default : '#ffffff',
  };
}

/** All 41 legacy generators as selectable, generator-backed EffectDefs. Scope is `kit`
    for every one: generators own their spatial layout (drum-locality is intrinsic — e.g.
    whole-drum lights only the struck drum from its trigger), so drum-masking a kit-wide
    field (plasma, radial-wash) would wrongly clip it. */
export const GENERATOR_EFFECTS: EffectDef[] = listEffects().map((gen): EffectDef => {
  const env = CATEGORY_ENV[gen.category];
  return {
    id: `gen:${gen.id}`,
    name: gen.name,
    pattern: 'flash', // ignored — generatorId drives rendering
    generatorId: gen.id,
    category: gen.category,
    busId: CATEGORY_BUS[gen.category],
    scope: 'kit',
    params: gen.paramSpec.map(mapParamSpec),
    attackMs: env.attackMs,
    sustainMs: env.sustainMs,
    releaseMs: env.releaseMs,
  };
});

/** The full selectable registry: the 10 pattern effects + the 41 generator effects. */
export const EFFECTS: EffectDef[] = [...PATTERN_EFFECTS, ...GENERATOR_EFFECTS];

const effectById = new Map(EFFECTS.map((e) => [e.id, e] as const));

export function effectScope(effectId: string): Scope {
  return effectById.get(effectId)?.scope ?? 'drum';
}

// ---- presets ----------------------------------------------------------------
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');

function preset(effectId: string, name: string, overrides: Record<string, number | boolean> = {}): Preset {
  const eff = effectById.get(effectId)!;
  return { id: `${effectId}:${slug(name)}`, name, effectId, params: { ...defaultParams(eff), ...overrides } };
}

export const PRESETS: Preset[] = [
  preset('swirl', 'Default'),
  preset('swirl', 'Wide', { bands: 4, hue: 200 }),
  preset('swirl', 'Fast', { speed: 2.3, hue: 300 }),
  preset('swirl', 'Sync', { tempoSync: true, bands: 3 }),
  preset('aurora', 'Default'),
  preset('aurora', 'Warm', { hue: 40 }),
  preset('drift', 'Default'),
  preset('chase', 'Default'),
  preset('chase', 'Tight', { width: 0.07, speed: 1.6 }),
  preset('chase', 'Sync', { tempoSync: true }),
  preset('whole', 'Default'),
  preset('sparkle', 'Default'),
  preset('sparkle', 'Dense', { density: 0.6 }),
  preset('rip', 'Default'),
  preset('wash', 'Default'),
  preset('strobe', 'Default'),
  preset('haze', 'Default'),
  // A Default preset for every generator effect so play nodes resolve `${id}:default`.
  ...GENERATOR_EFFECTS.map((e) => preset(e.id, 'Default')),
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
    linked: false,
  };
};

// --- starter trees that exercise the block set ------------------------------

const kickCenter: Block = play('whole', 'oneshot');
const snareCenter: Block = { id: bid('rand'), kind: 'random', noRepeat: true, children: [play('chase'), play('sparkle'), play('rip')] };
const snareRim: Block = { id: bid('all'), kind: 'all', children: [play('sparkle'), play('strobe')] };
const tomCenter: Block = { id: bid('seq'), kind: 'sequence', children: [play('chase'), play('rip'), play('whole')] };
// value+bands switch: 3 even bands (cutoffs 1/3, 2/3) == the old 3-child velocity split.
// treeToGraph wires the children onto band-0 / band-1 / band-2 in y-order.
const tomEdge: Block = {
  id: bid('switch'),
  kind: 'switch',
  on: 'value',
  valueMode: 'bands',
  bands: [1 / 3, 2 / 3],
  children: [play('sparkle'), play('chase'), play('whole')],
};
const kickShell: Block = { id: bid('toggle'), kind: 'toggle', child: play('haze', 'loop') };
const snareShell: Block = { id: bid('chance'), kind: 'chance', p: 0.5, child: play('strobe') };
const tomRim: Block = {
  id: bid('rand2'),
  kind: 'random',
  noRepeat: false,
  children: [play('wash', 'loop'), { id: bid('all2'), kind: 'all', children: [play('chase'), play('sparkle')] }],
};
const tom2Center: Block = { id: bid('seq2'), kind: 'sequence', children: [play('rip'), play('sparkle')] };
const tom2Rim: Block = { id: bid('chance2'), kind: 'chance', p: 0.7, child: play('whole') };

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
  { id: 'intro', name: 'Intro', looks: { base: 'drift', trigger: null, effect: 'haze' } },
  { id: 'verse', name: 'Verse', looks: { base: 'swirl', trigger: null, effect: null } },
  { id: 'chorus', name: 'Chorus', looks: { base: 'aurora', trigger: null, effect: 'wash' } },
];
