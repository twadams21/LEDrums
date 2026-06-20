<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import * as THREE from 'three';
  import type { SerializedModel } from '../ws/protocol-types';

  interface Props {
    model: SerializedModel;
    frame: Uint8Array | null;
    /** mm → scene-unit divisor. */
    scale: number;
  }

  let { model, frame, scale }: Props = $props();

  const count = $derived(model.count);

  // Cross-section of the square diffusion tube, in mm. Reads as LED tape inside
  // a frosted square tube (~10–16mm); 12mm sits in the sweet spot.
  const TUBE_MM = 12;
  // Fraction of each pixel's arc length the lit segment fills. The <1 gap
  // guarantees neighbouring segments never overlap.
  const FILL = 0.9;

  // Unit cube — scaled and oriented per-instance into a tube segment.
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  // Instance colours carry the live RGB frame. Keep the material white so
  // Three's instanceColor multiplier does not black out lit segments.
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    transparent: true,
    opacity: 0.95,
  });

  let mesh = $state<THREE.InstancedMesh | undefined>(undefined);

  // Scratch objects reused across instances to keep the build allocation-light.
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const scaleVec = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();

  // Build one oriented, sized tube segment per pixel whenever the mesh or model
  // changes. Each box is positioned at the pixel, oriented by the sent
  // tangent/normal basis, and sized so it occupies (most of) its arc length
  // along the hoop with a small square cross-section.
  $effect(() => {
    const m = mesh;
    if (!m) return;
    const { positions, tangents, normals, segmentLengths } = model;
    const thick = TUBE_MM / scale;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Orthonormal basis from the sent vectors. tangent runs along the hoop,
      // normal points radially outward; binormal completes the frame.
      t.set(tangents[i3]!, tangents[i3 + 1]!, tangents[i3 + 2]!).normalize();
      n.set(normals[i3]!, normals[i3 + 1]!, normals[i3 + 2]!).normalize();
      b.crossVectors(n, t).normalize();
      // Re-orthogonalize the normal in case the sent vectors were not perfectly
      // perpendicular, so the basis stays rigid (no shear in the box).
      n.crossVectors(t, b).normalize();

      pos.set(
        positions[i3]! / scale,
        positions[i3 + 1]! / scale,
        positions[i3 + 2]! / scale,
      );

      // Length along the hoop fills FILL of the arc; cross-section is the square
      // tube thickness along binormal and normal.
      const len = (segmentLengths[i]! / scale) * FILL;
      scaleVec.set(len, thick, thick);

      // Box local axes (x,y,z) map to (tangent, binormal, normal).
      matrix.makeBasis(t, b, n);
      matrix.scale(scaleVec);
      matrix.setPosition(pos);
      m.setMatrixAt(i, matrix);
    }
    m.instanceMatrix.needsUpdate = true;

    // Seed instance colours so the tube is visible before the first frame:
    // a dark grey so unlit segments read as frosted tube, not black voids.
    color.setRGB(0.05, 0.05, 0.07);
    for (let i = 0; i < count; i++) {
      m.setColorAt(i, color);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  // Push the latest frame's RGB triples onto instance colours each render task.
  useTask(() => {
    const m = mesh;
    const f = frame;
    if (!m || !f) return;
    const max = Math.min(count, Math.floor(f.length / 3));
    for (let i = 0; i < max; i++) {
      const i3 = i * 3;
      color.setRGB(f[i3]! / 255, f[i3 + 1]! / 255, f[i3 + 2]! / 255);
      m.setColorAt(i, color);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
</script>

<T.InstancedMesh
  bind:ref={mesh}
  args={[geometry, material, count]}
  frustumCulled={false}
/>
