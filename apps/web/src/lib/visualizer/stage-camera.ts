import type { Vec3Tuple } from './stage-geometry';

export type CameraPreset = 'overview' | 'audience' | 'front' | 'top';
export type PreviewPresentation = 'pixels' | 'stage';
export interface CameraFrame {
  position: Vec3Tuple;
  target: Vec3Tuple;
  near: number;
  far: number;
}

/** Value-based cache: fresh model/frame arrays must NEVER undo an operator's orbit. */
export function createCameraFraming() {
  let lastKey = '';
  let lastFrame: CameraFrame;
  return (center: Vec3Tuple, size: number, aspect: number, preset: CameraPreset, reset: number, halfExtents?: Vec3Tuple): CameraFrame => {
    const key = `${center.join(',')}/${size}/${aspect}/${preset}/${reset}/${halfExtents?.join(',') ?? ''}`;
    if (key === lastKey) return lastFrame;
    lastKey = key;
    const directions: Record<CameraPreset, Vec3Tuple> = {
      overview: [1, 0.7, 1], audience: [0.22, 0.12, 1], front: [0, 0, 1], top: [0, 1, 0.001],
    };
    const direction = directions[preset];
    const length = Math.hypot(...direction);
    const safeAspect = Math.max(0.1, aspect);
    const halfFov = Math.atan(Math.tan(Math.PI / 8) * Math.min(1, safeAspect));
    let distance = Math.max(6, size * Math.sqrt(3) / 2 / Math.sin(halfFov) * 1.1);
    if (halfExtents) {
      // Fit the actual box in THIS camera, including perspective depth. A max-side sphere
      // left the real drums occupying only half the canvas; naive zoom would clip narrow docks.
      const forward = direction.map((v) => v / length);
      const horizontal = Math.hypot(forward[0]!, forward[2]!);
      const right = [forward[2]! / horizontal, 0, -forward[0]! / horizontal];
      const up = [forward[1]! * right[2]!, horizontal, -forward[1]! * right[0]!];
      const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i]!, 0);
      distance = 6;
      for (let corner = 0; corner < 8; corner++) {
        const offset = halfExtents.map((v, i) => v * (corner & (1 << i) ? 1 : -1));
        const depth = dot(offset, forward);
        distance = Math.max(distance, depth + Math.abs(dot(offset, right)) * 1.1 / (Math.tan(Math.PI / 8) * safeAspect),
          depth + Math.abs(dot(offset, up)) * 1.1 / Math.tan(Math.PI / 8));
      }
    }
    lastFrame = {
      position: center.map((value, i) => value + direction[i]! / length * distance) as Vec3Tuple,
      target: [...center],
      near: Math.max(0.01, distance / 1000),
      far: Math.max(1000, distance * 20),
    };
    return lastFrame;
  };
}
