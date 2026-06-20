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
