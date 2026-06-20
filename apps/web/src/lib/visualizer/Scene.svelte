<script lang="ts">
  import { Canvas, T } from '@threlte/core';
  import { OrbitControls, Grid } from '@threlte/extras';
  import Pixels from './Pixels.svelte';
  import type { SerializedModel } from '../ws/protocol-types';

  interface Props {
    model: SerializedModel | null;
    frame: Uint8Array | null;
    dim?: boolean;
  }

  let { model, frame, dim = false }: Props = $props();

  // mm → scene units. 100mm = 1 unit keeps the kit roughly a few units across.
  const SCALE = 100;

  const sceneSize = $derived(model ? model.bounds.size / SCALE : 10);
  const center = $derived<[number, number, number]>(
    model
      ? [
          model.bounds.center[0] / SCALE,
          model.bounds.center[2] / SCALE,
          model.bounds.center[1] / SCALE,
        ]
      : [0, 0, 0],
  );
  // Camera distance frames the whole kit with headroom.
  const camDist = $derived(Math.max(6, sceneSize * 1.6));

  const drumOrigins = $derived(
    model
      ? model.drums.map((d) => {
          const start = d.pixelStart * 3;
          // Approximate a drum gizmo at its first pixel position.
          const px = model.positions[start] ?? 0;
          const py = model.positions[start + 1] ?? 0;
          const pz = model.positions[start + 2] ?? 0;
          return {
            id: d.id,
            color: d.color,
            pos: [px / SCALE, pz / SCALE, py / SCALE] as [number, number, number],
          };
        })
      : [],
  );
</script>

<div class="viz" class:dim>
  <Canvas>
    <T.PerspectiveCamera
      makeDefault
      position={[center[0] + camDist, center[1] + camDist * 0.7, center[2] + camDist]}
      fov={45}
      near={0.1}
      far={1000}
    >
      <OrbitControls
        enableDamping
        target={center}
      />
    </T.PerspectiveCamera>

    <T.AmbientLight intensity={0.6} />
    <T.DirectionalLight position={[10, 20, 10]} intensity={0.4} />

    <Grid
      position={[center[0], center[1] - sceneSize, center[2]]}
      cellColor="#1c2230"
      sectionColor="#2a3344"
      sectionSize={5}
      cellSize={1}
      fadeDistance={camDist * 4}
      infiniteGrid
    />

    {#if model}
      <Pixels {model} {frame} scale={SCALE} />
    {/if}

    {#each drumOrigins as origin (origin.id)}
      <T.Mesh position={origin.pos}>
        <T.SphereGeometry args={[0.12, 12, 12]} />
        <T.MeshBasicMaterial color={origin.color} toneMapped={false} />
      </T.Mesh>
    {/each}
  </Canvas>
</div>

<style>
  .viz {
    position: absolute;
    inset: 0;
    z-index: 0;
    transition: filter 0.2s ease;
  }
  .viz.dim {
    filter: brightness(0.35) saturate(0.4);
  }
</style>
