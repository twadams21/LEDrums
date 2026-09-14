<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { onMount } from 'svelte';
  import type { OrbitControls as ThreeOrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { createCameraFraming, type CameraPreset } from './stage-camera';
  import type { Vec3Tuple } from './stage-geometry';

  let { center, size, halfExtents, preset, reset }: {
    center: Vec3Tuple; size: number; halfExtents: Vec3Tuple; preset: CameraPreset; reset: number;
  } = $props();
  const { size: viewport } = useThrelte();
  const frameCamera = createCameraFraming();
  const framing = $derived(frameCamera(center, size, $viewport.width / Math.max(1, $viewport.height), preset, reset, halfExtents));
  let controls = $state.raw<ThreeOrbitControls>();
  // With damping off Threlte does not run a controls task. Explicitly update once per pose so
  // reduced-motion users still look AT a translated kit after a preset/reset, not at world zero.
  $effect(() => {
    const current = controls;
    const pose = framing;
    if (!current) return;
    current.object.position.set(...pose.position);
    current.target.set(...pose.target);
    current.update();
  });
  let reducedMotion = $state(true);
  onMount(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotion = query.matches; };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });
</script>

<T.PerspectiveCamera makeDefault position={framing.position} fov={45} near={framing.near} far={framing.far}>
  <!-- No auto-orbit or animated preset flight. Direct manipulation stays available under reduce. -->
  <OrbitControls bind:ref={controls} target={framing.target} enableDamping={!reducedMotion} />
</T.PerspectiveCamera>
