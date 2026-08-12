/* Pure helpers backing the Drums & Hoops settings pane (S4b) — no Svelte / DOM, so the
   hoop-index resolution and per-drum pixel totals are unit-testable in node. The pane
   re-homes the Patch drum/hoop/kit inspectors; the per-hoop pixel math itself stays in
   docks/patch-inspector.ts (shared, already covered). */

import type { DrumConfig, KitConfig } from '@ledrums/core';
import { perHoopPixelCount } from '../../docks/patch-inspector';
import type { HoopRef } from '../../patch-routing';

/** The 1-based hoop indices a drum HAS: an explicit `hoops[]` wins (its length IS the
    count), else the per-drum `hoopCount` override, else the kit global — the same
    resolution core and the inspectors use. */
export function hoopIndices(drum: DrumConfig, kit: KitConfig): number[] {
  const n = drum.hoops?.length ?? drum.hoopCount ?? kit.global.hoopCount;
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** Total pixels across ONE drum, honouring mixed per-hoop counts — the drum-card summary
    read-out (the whole-kit total lives in patch-inspector's totalKitPixelCount). */
export function drumPixelTotal(drum: DrumConfig, kit: KitConfig): number {
  return hoopIndices(drum, kit).reduce((sum, hoop) => sum + perHoopPixelCount(drum, kit, hoop), 0);
}

/** Resolve any routed {@link HoopRef} to its literal pixel count within `kit` — the
    span-walk callback for hoopPixelSpan. An unknown drum contributes 0 pixels. */
export function pixelsForHoopIn(kit: KitConfig): (h: HoopRef) => number {
  return (h) => {
    const drum = kit.drums.find((d) => d.id === h.drumId);
    return drum ? perHoopPixelCount(drum, kit, h.hoop) : 0;
  };
}
