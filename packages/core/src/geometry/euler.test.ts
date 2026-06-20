import { describe, expect, it } from 'vitest';
import { DEG2RAD, type Vec3 } from '../math';
import { eulerXYZApply } from './euler';

// Independent reference: apply Rz, then Ry, then Rx (Three.js 'XYZ' = Rx·Ry·Rz on a column vector).
function rotZ(v: Vec3, t: number): Vec3 {
  return { x: v.x * Math.cos(t) - v.y * Math.sin(t), y: v.x * Math.sin(t) + v.y * Math.cos(t), z: v.z };
}
function rotY(v: Vec3, t: number): Vec3 {
  return { x: v.x * Math.cos(t) + v.z * Math.sin(t), y: v.y, z: -v.x * Math.sin(t) + v.z * Math.cos(t) };
}
function rotX(v: Vec3, t: number): Vec3 {
  return { x: v.x, y: v.y * Math.cos(t) - v.z * Math.sin(t), z: v.y * Math.sin(t) + v.z * Math.cos(t) };
}
function reference(v: Vec3, deg: Vec3): Vec3 {
  return rotX(rotY(rotZ(v, deg.z * DEG2RAD), deg.y * DEG2RAD), deg.x * DEG2RAD);
}

function close(a: Vec3, b: Vec3, eps = 1e-9) {
  expect(a.x).toBeCloseTo(b.x, 8);
  expect(a.y).toBeCloseTo(b.y, 8);
  expect(a.z).toBeCloseTo(b.z, 8);
}

describe('eulerXYZApply', () => {
  it('rotation.x = 90 maps local +Z to world -Y', () => {
    close(eulerXYZApply({ x: 0, y: 0, z: 1 }, { x: 90, y: 0, z: 0 }), { x: 0, y: -1, z: 0 });
  });

  it('matches an independent compound-rotation reference (tom1 x:165 z:4)', () => {
    const v = { x: 3, y: -2, z: 5 };
    const rot = { x: 165, y: 0, z: 4 };
    close(eulerXYZApply(v, rot), reference(v, rot));
  });

  it('matches the reference across arbitrary compound rotations', () => {
    const v = { x: 1.5, y: -0.7, z: 2.3 };
    for (const rot of [
      { x: 30, y: 60, z: 90 },
      { x: 180, y: 0, z: 0 },
      { x: 165, y: 12, z: 4 },
      { x: -45, y: 200, z: 17 },
    ]) {
      close(eulerXYZApply(v, rot), reference(v, rot));
    }
  });
});
