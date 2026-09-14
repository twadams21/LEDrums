import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createCameraFraming, type CameraPreset } from './stage-camera';

describe('camera framing', () => {
  it('retains the exact pose object through fresh equal geometry/frame updates', () => {
    const frame = createCameraFraming();
    const first = frame([4, 8, -3], 12, 1.4, 'overview', 0, [6, 5, 4]);
    // OrbitControls may move the actual camera, but Threlte must never receive a new pose array.
    for (let i = 0; i < 50; i++) expect(frame([4, 8, -3], 12, 1.4, 'overview', 0, [6, 5, 4])).toBe(first);
    expect(frame([4, 8, -3], 12, 1.4, 'overview', 1, [6, 5, 4])).not.toBe(first);
  });
  it.each(['overview', 'audience', 'front', 'top'] as CameraPreset[])('fits a translated kit in a narrow viewport from %s', (preset) => {
    const pose = createCameraFraming()([100, 12, -80], 10, 0.4, preset, 0);
    const camera = new PerspectiveCamera(45, 0.4, pose.near, pose.far);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld(true);
    for (const x of [-5, 5]) for (const y of [-5, 5]) for (const z of [-5, 5]) {
      const p = new Vector3(100 + x, 12 + y, -80 + z).project(camera);
      expect(Math.abs(p.x)).toBeLessThan(1);
      expect(Math.abs(p.y)).toBeLessThan(1);
      expect(Math.abs(p.z)).toBeLessThan(1);
    }
  });
  it.each(['overview', 'audience', 'front', 'top'] as const)('fits the real box tightly from %s without losing perspective depth', (preset) => {
    for (const aspect of [0.25, 0.7, 1.7, 3]) {
      const pose = createCameraFraming()([100, 12, -80], 10, aspect, preset, 0, [5, 4, 3]);
      const camera = new PerspectiveCamera(45, aspect, pose.near, pose.far);
      camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld(true);
      let filled = 0;
      for (const x of [-5, 5]) for (const y of [-4, 4]) for (const z of [-3, 3]) {
        const p = new Vector3(100 + x, 12 + y, -80 + z).project(camera);
        expect(Math.abs(p.x)).toBeLessThan(0.92); expect(Math.abs(p.y)).toBeLessThan(0.92);
        filled = Math.max(filled, Math.abs(p.x), Math.abs(p.y));
      }
      expect(filled).toBeGreaterThan(0.90);
    }
  });
  it('offers distinct audience, straight front and top directions without a top singularity', () => {
    const frame = createCameraFraming();
    const audience = frame([0, 0, 0], 10, 1, 'audience', 0);
    const front = frame([0, 0, 0], 10, 1, 'front', 0);
    const top = frame([0, 0, 0], 10, 1, 'top', 0);
    expect(audience.position[1]).toBeGreaterThan(0);
    expect(front.position[0]).toBe(0);
    expect(front.position[1]).toBe(0);
    expect(top.position[1]).toBeGreaterThan(top.position[2] * 100);
    expect(top.position[2]).toBeGreaterThan(0);
  });
});
