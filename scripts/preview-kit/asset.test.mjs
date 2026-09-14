import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const asset = new URL('../../apps/web/public/models/acrylic-kit/kit.glb', import.meta.url);
const bytes = readFileSync(asset);
const jsonLength = bytes.readUInt32LE(12);
const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binaryOffset = 20 + jsonLength + 8;
const manifest = JSON.parse(readFileSync(new URL('../../apps/web/public/models/acrylic-kit/kit.manifest.json', import.meta.url)));
const report = JSON.parse(readFileSync(new URL('../../docs/reports/2026-09-14-stage-asset-export.json', import.meta.url)));
const roles = ['acrylic', 'head', 'metal', 'gasket', 'pcb', 'diffuser-body', 'led-lens', 'led-tape'];
function vectorAt(accessorIndex, i) {
  const accessor = gltf.accessors[accessorIndex];
  assert.equal(accessor.componentType, 5126); assert.equal(accessor.type, 'VEC3');
  const view = gltf.bufferViews[accessor.bufferView];
  const offset = binaryOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 12);
  return [bytes.readFloatLE(offset), bytes.readFloatLE(offset + 4), bytes.readFloatLE(offset + 8)];
}

test('self-contained, pinned, bounded real-model derivative has no baked look, cameras or invented supports', () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  assert.equal(bytes.readUInt32LE(24 + jsonLength), 0x004e4942);
  assert.equal(gltf.buffers.length, 1); assert.equal(gltf.buffers[0].uri, undefined);
  assert.ok(bytes.length <= 20 * 1024 * 1024);
  for (const key of ['images', 'textures', 'animations', 'skins', 'cameras', 'extensionsRequired']) assert.equal(gltf[key]?.length ?? 0, 0, key);
  assert.ok(gltf.nodes.every((node) => !/stand|floor|camera|light/i.test(node.name)));
  assert.equal(manifest.version, 1); assert.equal(manifest.units, 'metres'); assert.equal(manifest.axes, 'gltf-y-up');
  assert.equal(manifest.source.sha256, report.sourceSha256);
  assert.equal(report.sourceUnchanged, true); assert.equal(report.rendered, false);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.assetSha256);
  assert.equal(report.bytes, bytes.length);
  const triangles = gltf.meshes.flatMap((mesh) => mesh.primitives).reduce((sum, primitive) => {
    assert.ok(primitive.mode === undefined || primitive.mode === 4);
    assert.deepEqual(Object.keys(primitive.attributes).sort(), ['NORMAL', 'POSITION']);
    return sum + gltf.accessors[primitive.indices].count / 3;
  }, 0);
  assert.equal(triangles, report.triangles); assert.ok(triangles <= 320000);
});

test('four drum-local roots expose the actual material roles and sixteen independent interior LED bands', () => {
  assert.deepEqual(manifest.drums.map((d) => d.id), ['kick', 'snare', 'tom1', 'tom2']);
  assert.equal(manifest.drums.find((d) => d.id === 'tom2').cadId, 'floor-tom');
  for (const drum of manifest.drums) {
    const root = gltf.nodes.find((node) => node.name === drum.rootName);
    assert.equal(root.extras.stageDrumId, drum.id);
    const children = root.children.map((index) => gltf.nodes[index]);
    assert.equal(children.length, 17);
    for (const node of [root, ...children]) {
      // Shader sampling relies on child positions being in the drum-local glTF frame.
      for (const key of ['matrix', 'translation', 'rotation', 'scale']) assert.equal(node[key], undefined, `${node.name}: ${key}`);
    }
    assert.deepEqual([...new Set(children.map((n) => n.extras.stageRole))].sort(), [...roles].sort());
    for (const role of ['diffuser-body', 'led-lens', 'led-tape']) {
      assert.deepEqual(children.filter((n) => n.extras.stageRole === role).map((n) => n.extras.stageHoop).sort(), [1, 2, 3, 4]);
    }
    let shellRadius = 0;
    const shell = children.find((node) => node.extras.stageRole === 'acrylic');
    const shellAccessor = gltf.meshes[shell.mesh].primitives[0].attributes.POSITION;
    for (let i = 0; i < gltf.accessors[shellAccessor].count; i++) {
      const [x, y, z] = vectorAt(shellAccessor, i);
      assert.ok([x, y, z].every(Number.isFinite));
      shellRadius = Math.max(shellRadius, Math.hypot(x, z));
    }
    assert.ok(shellRadius * 1000 > drum.radiusMm + 15, `${drum.id}: shell must be OUTSIDE its internal LEDs`);
    // The source reused shell-acrylic on its thin head envelopes. Check the head role has
    // a real membrane, not only the woven rim wrap while the membrane becomes near-invisible.
    const head = children.find((node) => node.extras.stageRole === 'head');
    const primitive = gltf.meshes[head.mesh].primitives[0];
    const indices = gltf.accessors[primitive.indices];
    const view = gltf.bufferViews[indices.bufferView];
    const start = binaryOffset + (view.byteOffset ?? 0) + (indices.byteOffset ?? 0);
    assert.ok([5123, 5125].includes(indices.componentType));
    const indexAt = indices.componentType === 5125 ? (i) => bytes.readUInt32LE(start + i * 4) : (i) => bytes.readUInt16LE(start + i * 2);
    let projectedArea = 0;
    for (let i = 0; i < indices.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((n) => vectorAt(primitive.attributes.POSITION, indexAt(i + n)));
      projectedArea += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
    }
    assert.ok(projectedArea >= Math.PI * (drum.radiusMm / 1000) ** 2, `${drum.id}: head membrane is missing from the head role`);
    for (const node of children.filter((n) => n.extras.stageRole === 'led-tape')) {
      const accessor = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
      const centerMm = (accessor.min[1] + accessor.max[1]) * 500;
      assert.ok(Math.abs(centerMm - (node.extras.stageHoop - 2.5) * drum.hoopSpacingMm) < 0.1, `${node.name}: hoop plane`);
      const index = gltf.meshes[node.mesh].primitives[0].attributes.POSITION;
      for (let i = 0; i < accessor.count; i++) {
        const [x, , z] = vectorAt(index, i);
        assert.ok(Math.abs(Math.hypot(x, z) * 1000 - drum.radiusMm) < 0.7, `${node.name}: tape radius`);
      }
    }
  }
});
