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

  // One small box per pixel. Geometry + material are shared across instances.
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ toneMapped: false });

  let mesh = $state<THREE.InstancedMesh | undefined>(undefined);

  // Position every instance once when the mesh + model are available.
  $effect(() => {
    const m = mesh;
    if (!m) return;
    const dummy = new THREE.Object3D();
    const positions = model.positions;
    for (let i = 0; i < count; i++) {
      dummy.position.set(
        positions[i * 3]! / scale,
        positions[i * 3 + 1]! / scale,
        positions[i * 3 + 2]! / scale,
      );
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    // Seed instance colors so the kit is visible before the first frame.
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      m.setColorAt(i, color.setRGB(0.04, 0.04, 0.06));
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  const color = new THREE.Color();

  // Push the latest frame's RGB triples onto instance colors each render task.
  useTask(() => {
    const m = mesh;
    const f = frame;
    if (!m || !f) return;
    const n = Math.min(count, Math.floor(f.length / 3));
    for (let i = 0; i < n; i++) {
      color.setRGB(f[i * 3]! / 255, f[i * 3 + 1]! / 255, f[i * 3 + 2]! / 255);
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
