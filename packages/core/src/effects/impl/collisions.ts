import { hsvToRgb } from '../../color/color';
import { clamp01, hashString, wrap } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum, type EffectGenerator } from '../types';

interface HoopNodes {
  drumId: string;
  hoopIndex: number;
  /** Base phase per node (deg) and direction (+1 / -1). */
  basePhase: number[];
  dir: number[];
  /** Lingering flash at a collision angle, with intensity that decays. */
  flashAngle: number;
  flashLevel: number;
}

export interface CollisionsState {
  hoops: HoopNodes[];
}

/** Smallest angular separation between two angles (degrees), 0..180. */
function angularDist(a: number, b: number): number {
  const d = Math.abs(wrap(a, 360) - wrap(b, 360));
  return d > 180 ? 360 - d : d;
}

/**
 * Collisions: each hoop carries N nodes circling around it; alternate nodes spin
 * in opposite directions so they periodically meet. When two nodes pass within a
 * threshold angle they "collide", flashing a localized arc in `flashHue`. Stateful;
 * node phases are seeded from a hash of drumId+hoop for deterministic replay.
 */
export const collisions: EffectGenerator<CollisionsState> = {
  id: 'collisions',
  name: 'Collisions',
  category: 'wash',
  paramSpec: [
    { key: 'hue', label: 'Hue', type: 'number', default: 180, min: 0, max: 360, unit: '°' },
    { key: 'saturation', label: 'Saturation', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'flashHue', label: 'Flash Hue', type: 'number', default: 50, min: 0, max: 360, unit: '°' },
    { key: 'brightness', label: 'Brightness', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
    { key: 'nodesPerHoop', label: 'Nodes / Hoop', type: 'number', default: 2, min: 2, max: 8, step: 1 },
    { key: 'speed', label: 'Speed', type: 'number', default: 90, min: 0, max: 720, unit: '°/s' },
    { key: 'flashWidthDeg', label: 'Flash Width', type: 'number', default: 30, min: 4, max: 120, unit: '°' },
  ],
  createState(model: PixelModel): CollisionsState {
    const hoops: HoopNodes[] = [];
    for (const drum of model.drums) {
      for (let h = 0; h < drum.hoopCount; h++) {
        const seed = hashString(`${drum.drumId}:${h}`);
        const rng = ((seed >>> 0) % 360);
        hoops.push({
          drumId: drum.drumId,
          hoopIndex: h,
          // Filled lazily on first render once nodesPerHoop is known.
          basePhase: [rng],
          dir: [1],
          flashAngle: 0,
          flashLevel: 0,
        });
      }
    }
    return { hoops };
  },
  render(ctx, params, fb, state) {
    const hue = pnum(params, 'hue', 180);
    const sat = pnum(params, 'saturation', 1);
    const flashHue = pnum(params, 'flashHue', 50);
    const bri = pnum(params, 'brightness', 1);
    const nodesPerHoop = Math.max(2, Math.round(pnum(params, 'nodesPerHoop', 2)));
    const speed = pnum(params, 'speed', 90);
    const flashWidth = Math.max(1, pnum(params, 'flashWidthDeg', 30));

    const nodeWidth = Math.max(6, flashWidth * 0.5);
    const collideThresh = Math.max(2, flashWidth * 0.4);

    // Decay any active flashes.
    const flashDecay = Math.exp(-ctx.dt / 220);

    // Pre-compute node angles per hoop and detect collisions.
    for (const hoop of state.hoops) {
      // (Re)seed base phases/dirs if nodesPerHoop changed since createState.
      if (hoop.basePhase.length !== nodesPerHoop) {
        const seed = hashString(`${hoop.drumId}:${hoop.hoopIndex}`);
        hoop.basePhase = [];
        hoop.dir = [];
        for (let n = 0; n < nodesPerHoop; n++) {
          hoop.basePhase.push(((seed >>> (n % 8)) % 360) + (360 * n) / nodesPerHoop);
          hoop.dir.push(n % 2 === 0 ? 1 : -1);
        }
      }

      const t = ctx.timeMs / 1000;
      const angles: number[] = [];
      for (let n = 0; n < nodesPerHoop; n++) {
        angles.push(wrap(hoop.basePhase[n]! + hoop.dir[n]! * speed * t, 360));
      }

      // Detect collisions between counter-rotating nodes.
      for (let i = 0; i < angles.length; i++) {
        for (let j = i + 1; j < angles.length; j++) {
          if (hoop.dir[i] === hoop.dir[j]) continue; // only opposing nodes "collide"
          const d = angularDist(angles[i]!, angles[j]!);
          if (d < collideThresh) {
            // Flash the midpoint arc.
            hoop.flashAngle = angles[i]!;
            hoop.flashLevel = 1;
          }
        }
      }
      hoop.flashLevel *= flashDecay;

      // Render this hoop's pixels.
      const drum = ctx.model.drumById.get(hoop.drumId);
      if (!drum) continue;
      for (let p = drum.pixelStart; p < drum.pixelStart + drum.pixelCount; p++) {
        const pix = ctx.model.pixels[p]!;
        if (pix.hoopIndex !== hoop.hoopIndex) continue;

        // Flash overlay (localized, brighter, different hue) takes priority.
        if (hoop.flashLevel > 0.004) {
          const fd = angularDist(pix.angleDeg, hoop.flashAngle);
          if (fd < flashWidth) {
            const v = clamp01(bri * hoop.flashLevel * (1 - fd / flashWidth));
            if (v >= 0.004) {
              const rgb = hsvToRgb(flashHue, sat, v);
              fb.max(p, rgb.r, rgb.g, rgb.b, v);
            }
          }
        }

        // The circling nodes themselves.
        let best = 0;
        for (let n = 0; n < nodesPerHoop; n++) {
          const d = angularDist(pix.angleDeg, angles[n]!);
          if (d < nodeWidth) best = Math.max(best, 1 - d / nodeWidth);
        }
        if (best < 0.004) continue;
        const v = clamp01(bri * best * 0.7);
        const rgb = hsvToRgb(hue, sat, v);
        fb.max(p, rgb.r, rgb.g, rgb.b, v);
      }
    }
  },
};
