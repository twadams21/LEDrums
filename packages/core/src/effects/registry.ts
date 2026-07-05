import type { EffectGenerator } from './types';
import { EFFECT_METADATA } from './metadata';
import { collectionOf, type PlayType } from './vocabulary';
import { isCanvasEffectId } from '../canvas/ids';
import { tryGetCanvasEffect } from '../canvas/registry';
import { solidBase } from './impl/solid-base';
import { chase } from './impl/chase';
import { wholeDrum } from './impl/whole-drum';
import { wholeKit } from './impl/whole-kit';
import { followHoop } from './impl/follow-hoop';
import { radialWash } from './impl/radial-wash';
import { wipe3d } from './impl/wipe-3d';
import { meterEq } from './impl/meter-eq';
import { pixelAccum } from './impl/pixel-accum';
import { colourMelody } from './impl/colour-melody';
import { strobe } from './impl/strobe';
import { syncedHoops } from './impl/synced-hoops';
import { burst } from './impl/burst';
import { swing } from './impl/swing';
import { sidechain } from './impl/sidechain';
import { sacredHogs } from './impl/sacred-hogs';
import { collisions } from './impl/collisions';
// 2D UV texture fields
import { plasma } from './impl/plasma';
import { fire } from './impl/fire';
import { ripplePond } from './impl/ripple-pond';
import { rainbowFlow } from './impl/rainbow-flow';
import { tunnel } from './impl/tunnel';
import { checkerPulse } from './impl/checker-pulse';
import { perlinClouds } from './impl/perlin-clouds';
import { lavaLamp } from './impl/lava-lamp';
import { interference } from './impl/interference';
import { caustics } from './impl/caustics';
import { spiral } from './impl/spiral';
import { gridGlow } from './impl/grid-glow';
// Particles / spatial
import { starfield } from './impl/starfield';
import { cometTrails } from './impl/comet-trails';
import { lightning } from './impl/lightning';
import { confettiBurst } from './impl/confetti-burst';
import { helix } from './impl/helix';
import { orbitRings } from './impl/orbit-rings';
// Spatial / musical
import { gravityWells } from './impl/gravity-wells';
import { breathingKit } from './impl/breathing-kit';
import { tempSweep } from './impl/temp-sweep';
import { velocityFlames } from './impl/velocity-flames';
import { hueRotateKit } from './impl/hue-rotate-kit';
import { waveCollapse } from './impl/wave-collapse';
// Emission-based 3D batch (2026-07-05): per-hit emissions that layer instead of stacking.
import { chaseBands } from './impl/chase-bands';
import { ripple3d } from './impl/ripple-3d';
import { sparkArc } from './impl/spark-arc';
import { rain3d } from './impl/rain-3d';

const ALL: EffectGenerator<any>[] = [
  solidBase,
  chase,
  wholeDrum,
  wholeKit,
  followHoop,
  radialWash,
  wipe3d,
  meterEq,
  pixelAccum,
  colourMelody,
  strobe,
  syncedHoops,
  burst,
  swing,
  sidechain,
  sacredHogs,
  collisions,
  plasma,
  fire,
  ripplePond,
  rainbowFlow,
  tunnel,
  checkerPulse,
  perlinClouds,
  lavaLamp,
  interference,
  caustics,
  spiral,
  gridGlow,
  starfield,
  cometTrails,
  lightning,
  confettiBurst,
  helix,
  orbitRings,
  gravityWells,
  breathingKit,
  tempSweep,
  velocityFlames,
  hueRotateKit,
  waveCollapse,
  chaseBands,
  ripple3d,
  sparkArc,
  rain3d,
];

const registry = new Map<string, EffectGenerator<any>>();
for (const e of ALL) {
  if (registry.has(e.id)) throw new Error(`Duplicate effect id: ${e.id}`);
  // Merge central metadata (description/tags/deprecated) onto the generator so the seam
  // carries it without editing 45 impl files (D1). Any fields already on the impl win.
  const meta = EFFECT_METADATA[e.id];
  registry.set(e.id, meta ? { ...meta, ...e } : e);
}

export function getEffect(id: string): EffectGenerator<any> {
  const e = tryGetEffect(id);
  if (!e) throw new Error(`Unknown effect: ${id}`);
  return e;
}

export function tryGetEffect(id: string): EffectGenerator<any> | undefined {
  // Canvas scenes resolve through the SAME lookup the bridge already uses for hosted
  // generators (`canvas:<sceneId>` → memoized scene adapter) — one uniform seam, no
  // compositor/bridge fork (locked decision 7).
  return registry.get(id) ?? tryGetCanvasEffect(id);
}

export function listEffects(): EffectGenerator<any>[] {
  return [...registry.values()];
}

export function effectIds(): string[] {
  return [...registry.keys()];
}

/**
 * The {@link PlayType} an effect id belongs to — U1's first-tag-match collection
 * derivation, made TOTAL over ids (D3 hydrate migration): a `canvas:<sceneId>` id is
 * `'canvas'`; a registered generator derives from its tags; an unknown id falls back to
 * `'ambient'` (same fallback `collectionOf` uses for an untagged effect), so persisted
 * play nodes always infer a type.
 */
export function playTypeForEffect(effectId: string): PlayType {
  if (isCanvasEffectId(effectId)) return 'canvas';
  return collectionOf(registry.get(effectId)?.tags);
}
