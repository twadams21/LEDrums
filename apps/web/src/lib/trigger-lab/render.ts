/* Offline output adapter. All float rendering and voice state live in the core runtime
 * owned by Sim; this boundary only converts the final RGBA frame to preview RGB bytes.
 * In particular, Mix/Splice members are never quantized before downstream modifiers. */
import type { Sim } from './sim';
import type { LabModel } from './kit';

/** Render once after the sim tick; additive composition has already happened in float. */
export function renderFrame(buf: Uint8Array, sim: Sim, lab: LabModel): void {
  buf.fill(0);
  const rgba = sim.render(lab.pm);
  for (let i = 0; i < lab.pm.pixelCount; i++) {
    const j = i * 4;
    const k = i * 3;
    buf[k] = Math.round(rgba[j]! * 255);
    buf[k + 1] = Math.round(rgba[j + 1]! * 255);
    buf[k + 2] = Math.round(rgba[j + 2]! * 255);
  }
}
