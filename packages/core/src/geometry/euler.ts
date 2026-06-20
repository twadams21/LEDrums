import { DEG2RAD, type Vec3 } from '../math';

/**
 * Rotate a vector by Euler angles using Three.js **intrinsic `XYZ`** order, so the
 * pure `core` geometry and the Threlte visualizer agree by construction (plan A2/U2).
 *
 * Three.js `Euler('XYZ')` builds the matrix `M = Rx · Ry · Rz`; applied to a column
 * vector this rotates about Z first, then Y, then X. We replicate that exact matrix.
 */
export function eulerXYZApply(v: Vec3, rotDeg: Vec3): Vec3 {
  const x = rotDeg.x * DEG2RAD;
  const y = rotDeg.y * DEG2RAD;
  const z = rotDeg.z * DEG2RAD;

  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);

  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  // Column-major basis (matches Three.js Matrix4.makeRotationFromEuler, order 'XYZ').
  const m00 = c * e;
  const m01 = -c * f;
  const m02 = d;
  const m10 = af + be * d;
  const m11 = ae - bf * d;
  const m12 = -b * c;
  const m20 = bf - ae * d;
  const m21 = be + af * d;
  const m22 = a * c;

  return {
    x: m00 * v.x + m01 * v.y + m02 * v.z,
    y: m10 * v.x + m11 * v.y + m12 * v.z,
    z: m20 * v.x + m21 * v.y + m22 * v.z,
  };
}

/** Local → world transform: rotate (intrinsic XYZ) then translate by origin. */
export function localToWorld(local: Vec3, rotDeg: Vec3, origin: Vec3): Vec3 {
  const r = eulerXYZApply(local, rotDeg);
  return { x: r.x + origin.x, y: r.y + origin.y, z: r.z + origin.z };
}
