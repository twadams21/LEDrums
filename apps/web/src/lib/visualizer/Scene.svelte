<script lang="ts">
  import { untrack } from 'svelte';
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

  // A value-stable framing key — it only changes when the kit's center/size
  // actually change (kit swap / resize). Because it's a primitive, Svelte's
  // $derived short-circuits when it's unchanged, so the pose below does NOT
  // recompute on the spurious per-hit re-runs of `center`/`camDist`.
  const framingKey = $derived(
    model ? `${center[0]},${center[1]},${center[2]},${camDist}` : 'none',
  );
  // Camera pose + controls target, recomputed only when `framingKey` changes.
  // Binding the camera position + OrbitControls target straight to `center`/
  // `camDist` made every pad hit re-apply the pose and clobber the user's
  // orbit/zoom: a hit invalidates the model-derived chain, handing Threlte fresh
  // [x,y,z] arrays even when the values are identical, so it re-ran
  // camera.position.set()/controls.target.set(). Reading center/camDist via
  // untrack keeps `framingKey` the ONLY reactive dependency, so identical-value
  // churn leaves the camera exactly where the user put it. Only the pixel
  // COLORS update per frame.
  const framing = $derived.by(() => {
    void framingKey;
    return untrack((): { pos: [number, number, number]; target: [number, number, number] } => {
      if (!model) return { pos: [16, 11.2, 16], target: [0, 0, 0] };
      const [cx, cy, cz] = center;
      const d = camDist;
      return { pos: [cx + d, cy + d * 0.7, cz + d], target: [cx, cy, cz] };
    });
  });
</script>

<div class="viz" class:dim>
  <Canvas>
    <T.PerspectiveCamera
      makeDefault
      position={framing.pos}
      fov={45}
      near={0.1}
      far={1000}
    >
      <OrbitControls
        enableDamping
        target={framing.target}
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
