import { Matrix4, Vector3 } from 'three';
import type { SerializedDrum, SerializedModel } from '../ws/protocol-types';
import type { StageManifestDrum } from './stage-asset';
import { SCENE_SCALE } from './stage-geometry';

export type StagePose = NonNullable<SerializedDrum['stage']>;
export interface StageHoopBinding { start: number; count: number; phase: number; direction: 1 | -1 }
export const MAX_STAGE_PIXELS_PER_HOOP = 2048;
export const MAX_STAGE_HOOPS = 128;
export const STAGE_DIMENSION_TOLERANCE_MM = 0.05;
const TAU = Math.PI * 2;
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Physical drum-local glTF (X,Z,-Y), metres → the existing preview's (X,Z,Y), mm/100.
 * Do not orthogonalize via cross products: a kit mirror deliberately has negative determinant. */
export function stagePoseMatrix(pose: StagePose): Matrix4 {
  const axis = (v: number[], sign = 1) => new Vector3(v[0], v[2], v[1]).multiplyScalar(sign * 1000 / SCENE_SCALE);
  return new Matrix4().makeBasis(axis(pose.xAxis), axis(pose.zAxis), axis(pose.yAxis, -1))
    .setPosition(pose.origin[0] / SCENE_SCALE, pose.origin[2] / SCENE_SCALE, pose.origin[1] / SCENE_SCALE);
}

function validPose(pose: StagePose): boolean {
  const axes = [pose.xAxis, pose.yAxis, pose.zAxis];
  return pose.origin.length === 3 && pose.origin.every(Number.isFinite) &&
    axes.every((v) => v.length === 3 && v.every(Number.isFinite) && Math.abs(Math.hypot(...v) - 1) < 1e-6) &&
    Math.abs(dot(axes[0]!, axes[1]!)) < 1e-6 && Math.abs(dot(axes[0]!, axes[2]!)) < 1e-6 && Math.abs(dot(axes[1]!, axes[2]!)) < 1e-6;
}

/** A changed strip density is sampleable; changed physical dimensions are NOT stretchable. */
export function stageMismatch(drum: SerializedDrum, reference: StageManifestDrum | undefined, model: SerializedModel): string | null {
  if (!reference) return 'no matching asset';
  const pose = drum.stage;
  if (!pose) return 'body placement unavailable';
  if (!validPose(pose)) return 'invalid body placement';
  if (!Number.isFinite(pose.radiusMm) || !Number.isFinite(pose.hoopSpacingMm) ||
    Math.abs(pose.radiusMm - reference.radiusMm) > STAGE_DIMENSION_TOLERANCE_MM ||
    Math.abs(pose.hoopSpacingMm - reference.hoopSpacingMm) > STAGE_DIMENSION_TOLERANCE_MM ||
    pose.hoopPixelCounts.length !== reference.hoopPixelCounts.length) return 'dimensions differ';
  if (pose.hoopPixelCounts.some((count) => !Number.isInteger(count) || count < 1)) return 'invalid hoop counts';
  if (pose.hoopPixelCounts.some((count) => count > MAX_STAGE_PIXELS_PER_HOOP)) return 'LED preview limit';
  if (!Number.isInteger(drum.pixelStart) || drum.pixelStart < 0 ||
    pose.hoopPixelCounts.reduce((sum, n) => sum + n, 0) !== drum.pixelCount ||
    drum.pixelStart + drum.pixelCount > model.count) return 'incomplete pixel geometry';
  return null;
}

function normalAngle(model: SerializedModel, index: number, pose: StagePose): number {
  const offset = index * 3;
  const normal = model.normals.slice(offset, offset + 3);
  const x = dot(normal, pose.xAxis), y = dot(normal, pose.yAxis);
  if (![x, y].every(Number.isFinite) || Math.hypot(x, y) < 0.99) throw new Error('Invalid LED normal');
  return Math.atan2(y, x);
}

/** Prefix counts are authoritative. Tangents need not follow strip reverse, so infer direction
 * from the next NORMAL. One/two pixels are direction-invariant; never read the following hoop. */
export function bindStageHoops(model: SerializedModel, drum: SerializedDrum): StageHoopBinding[] {
  if (!drum.stage) throw new Error('Missing body placement');
  const pose = drum.stage;
  let start = drum.pixelStart;
  return pose.hoopPixelCounts.map((count) => {
    const phase = normalAngle(model, start, pose);
    let direction: 1 | -1 = 1;
    if (count > 2) {
      const delta = normalAngle(model, start + 1, pose) - phase;
      const step = Math.atan2(Math.sin(delta), Math.cos(delta));
      if (Math.abs(Math.abs(step) - TAU / count) > 1e-4) throw new Error('Invalid LED sweep');
      direction = step < 0 ? -1 : 1;
    }
    const result = { start, count, phase, direction };
    start += count;
    return result;
  });
}

/** CPU counterpart of the cylindrical shader address, also useful for fixture verification. */
export function stagePixelAtAngle(angle: number, hoop: StageHoopBinding): number {
  const turns = hoop.direction * (angle - hoop.phase) / TAU;
  return Math.floor((turns - Math.floor(turns)) * hoop.count + 0.5) % hoop.count;
}
