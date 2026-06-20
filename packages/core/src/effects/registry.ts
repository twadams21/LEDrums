import type { EffectGenerator } from './types';
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
];

const registry = new Map<string, EffectGenerator<any>>();
for (const e of ALL) {
  if (registry.has(e.id)) throw new Error(`Duplicate effect id: ${e.id}`);
  registry.set(e.id, e);
}

export function getEffect(id: string): EffectGenerator<any> {
  const e = registry.get(id);
  if (!e) throw new Error(`Unknown effect: ${id}`);
  return e;
}

export function tryGetEffect(id: string): EffectGenerator<any> | undefined {
  return registry.get(id);
}

export function listEffects(): EffectGenerator<any>[] {
  return [...registry.values()];
}

export function effectIds(): string[] {
  return [...registry.keys()];
}
