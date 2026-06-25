<script lang="ts">
  import { T, useTask } from '@threlte/core';
  import { untrack } from 'svelte';
  import * as THREE from 'three';
  import type { SerializedModel } from '../ws/protocol-types';

  interface Props {
    model: SerializedModel;
    frame: Uint8Array | null;
    /** mm → scene-unit divisor. */
    scale: number;
  }

  let { model, frame, scale }: Props = $props();

  // Radial width (mm) of the lit ring band — inner radius → outer radius. The
  // band lies in each hoop's plane and segments tile it end-to-end, so the ring
  // reads as one continuous strip of light rather than separate beads.
  const BAND_MM = 18;
  // Hoop-boundary thresholds (data-only — SerializedModel carries no hoopCount,
  // so this also works for the live server kit). The PRIMARY test is axial: the
  // step between two pixels in the same ring barely moves along the hoop axis,
  // but crossing to the next ring jumps ~hoopSpacing (≈60mm) along it — and that
  // is independent of pixel density (a raw-distance test alone misses close-
  // packed rings at low density, where the inter-ring leap is only ~2× the pitch).
  // AXIAL_K is a fraction of the local pitch; HOOP_GAP_K is a coarser distance
  // fallback that also catches any large positional leap.
  const AXIAL_K = 0.5;
  const HOOP_GAP_K = 2.5;
  // Per pixel: 3 cross-sections (midBefore · center · midAfter) × 2 radial edge
  // points = 6 vertices; 2 quads = 4 triangles = 12 index entries. Building the
  // segment through the pixel's own position (not just the two midpoints) keeps
  // the ribbon curved along the ring; sharing the midpoint cross-sections with
  // neighbours (coincident, per-pixel-coloured) makes the joins gap-free.
  const VPP = 6;
  const IPP = 12;

  // Unlit segments read as a dark frosted band, not black voids.
  const DARK_R = 0.05;
  const DARK_G = 0.05;
  const DARK_B = 0.07;

  // Geometry + material live for the component's lifetime; the cold build swaps
  // the geometry's attributes in place, the hot path only rewrites colours.
  // vertexColors carries the live RGB frame; DoubleSide keeps the flat annular
  // band visible from either face of the hoop.
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
  });

  // mm-space (x,y,z) → Three's Y-up scene (x, z, y), scaled to scene units.
  function readPos(m: SerializedModel, idx: number, s: number, out: number[]): void {
    const j = idx * 3;
    out[0] = m.positions[j]! / s;
    out[1] = m.positions[j + 2]! / s;
    out[2] = m.positions[j + 1]! / s;
  }
  // Outward radial normal, same axis swap, normalized.
  function readNrm(m: SerializedModel, idx: number, out: number[]): void {
    const j = idx * 3;
    const x = m.normals[j]!;
    const y = m.normals[j + 2]!;
    const z = m.normals[j + 1]!;
    const len = Math.hypot(x, y, z) || 1;
    out[0] = x / len;
    out[1] = y / len;
    out[2] = z / len;
  }
  function avgN(a: number[], b: number[], out: number[]): void {
    const x = a[0]! + b[0]!;
    const y = a[1]! + b[1]!;
    const z = a[2]! + b[2]!;
    const len = Math.hypot(x, y, z) || 1;
    out[0] = x / len;
    out[1] = y / len;
    out[2] = z / len;
  }
  // Write one radial edge point: cross-section position p offset by ±half along
  // the (in-plane) radial n.
  function edge(arr: Float32Array, o: number, p: number[], n: number[], s: number): void {
    arr[o] = p[0]! + n[0]! * s;
    arr[o + 1] = p[1]! + n[1]! * s;
    arr[o + 2] = p[2]! + n[2]! * s;
  }

  // Split each drum's pixel run into contiguous hoops. A boundary is where the
  // step to the next pixel jumps along the hoop AXIS (tangent × normal) — i.e.
  // onto a different ring — or makes a large positional leap (the coarse
  // fallback). Per-drum so two drums never merge.
  function buildHoops(m: SerializedModel): number[][] {
    const hoops: number[][] = [];
    const pos = m.positions;
    const tan = m.tangents;
    const nrm = m.normals;
    for (const drum of m.drums) {
      const end = drum.pixelStart + drum.pixelCount;
      let cur: number[] = [];
      for (let i = drum.pixelStart; i < end; i++) {
        if (cur.length > 0) {
          const prev = cur[cur.length - 1]!;
          const j = prev * 3;
          const sx = pos[i * 3]! - pos[j]!;
          const sy = pos[i * 3 + 1]! - pos[j + 1]!;
          const sz = pos[i * 3 + 2]! - pos[j + 2]!;
          const dist = Math.hypot(sx, sy, sz);
          // Hoop axis (binormal) at prev = tangent × normal, normalized.
          let bx = tan[j + 1]! * nrm[j + 2]! - tan[j + 2]! * nrm[j + 1]!;
          let by = tan[j + 2]! * nrm[j]! - tan[j]! * nrm[j + 2]!;
          let bz = tan[j]! * nrm[j + 1]! - tan[j + 1]! * nrm[j]!;
          const blen = Math.hypot(bx, by, bz) || 1;
          bx /= blen;
          by /= blen;
          bz /= blen;
          const axial = Math.abs(sx * bx + sy * by + sz * bz);
          const segLen = m.segmentLengths[prev] || 1;
          if (axial > AXIAL_K * segLen || dist > HOOP_GAP_K * segLen) {
            hoops.push(cur);
            cur = [];
          }
        }
        cur.push(i);
      }
      if (cur.length) hoops.push(cur);
    }
    return hoops;
  }

  // Cold path: build the merged arc-segment geometry. Returns the pixel count it
  // laid out (so the hot colour path knows how many segments exist).
  function buildGeometry(m: SerializedModel, s: number): number {
    const count = m.count;
    if (!count) {
      geometry.setIndex(null);
      geometry.deleteAttribute('position');
      geometry.deleteAttribute('color');
      return 0;
    }
    const positions = new Float32Array(count * VPP * 3);
    const colors = new Float32Array(count * VPP * 3);
    const index = new Uint32Array(count * IPP);
    const half = BAND_MM / s / 2;

    // Scratch — reused per pixel to keep the build allocation-light.
    const pC: number[] = [0, 0, 0];
    const nC: number[] = [0, 0, 0];
    const pP: number[] = [0, 0, 0];
    const nP: number[] = [0, 0, 0];
    const pN: number[] = [0, 0, 0];
    const nN: number[] = [0, 0, 0];
    const pB: number[] = [0, 0, 0];
    const nB: number[] = [0, 0, 0];
    const pA: number[] = [0, 0, 0];
    const nA: number[] = [0, 0, 0];
    const a0: number[] = [0, 0, 0];
    const b0: number[] = [0, 0, 0];

    for (const H of buildHoops(m)) {
      const L = H.length;
      // A hoop is a closed ring when its first and last pixel sit one step apart
      // (a full circle); then prev/next wrap so the ring closes with no seam.
      readPos(m, H[0]!, s, a0);
      readPos(m, H[L - 1]!, s, b0);
      const span = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!);
      const closed = L > 2 && span <= (HOOP_GAP_K * (m.segmentLengths[H[0]!] || 1)) / s;

      for (let t = 0; t < L; t++) {
        const i = H[t]!;
        const prev = closed ? H[(t - 1 + L) % L]! : H[Math.max(0, t - 1)]!;
        const next = closed ? H[(t + 1) % L]! : H[Math.min(L - 1, t + 1)]!;

        readPos(m, i, s, pC);
        readNrm(m, i, nC);
        readPos(m, prev, s, pP);
        readNrm(m, prev, nP);
        readPos(m, next, s, pN);
        readNrm(m, next, nN);

        // Cross-sections at the midpoints share an edge with the neighbour's
        // matching midpoint → continuous, gap-free tiling around the ring.
        pB[0] = (pP[0]! + pC[0]!) * 0.5;
        pB[1] = (pP[1]! + pC[1]!) * 0.5;
        pB[2] = (pP[2]! + pC[2]!) * 0.5;
        pA[0] = (pC[0]! + pN[0]!) * 0.5;
        pA[1] = (pC[1]! + pN[1]!) * 0.5;
        pA[2] = (pC[2]! + pN[2]!) * 0.5;
        avgN(nP, nC, nB);
        avgN(nC, nN, nA);

        const v = i * VPP * 3;
        edge(positions, v + 0, pB, nB, -half); // innerB
        edge(positions, v + 3, pB, nB, +half); // outerB
        edge(positions, v + 6, pC, nC, -half); // innerC
        edge(positions, v + 9, pC, nC, +half); // outerC
        edge(positions, v + 12, pA, nA, -half); // innerA
        edge(positions, v + 15, pA, nA, +half); // outerA

        for (let k = 0; k < VPP; k++) {
          const o = v + k * 3;
          colors[o] = DARK_R;
          colors[o + 1] = DARK_G;
          colors[o + 2] = DARK_B;
        }

        const vb = i * VPP;
        const ib = i * IPP;
        // quad midBefore→center
        index[ib] = vb;
        index[ib + 1] = vb + 1;
        index[ib + 2] = vb + 3;
        index[ib + 3] = vb;
        index[ib + 4] = vb + 3;
        index[ib + 5] = vb + 2;
        // quad center→midAfter
        index[ib + 6] = vb + 2;
        index[ib + 7] = vb + 3;
        index[ib + 8] = vb + 5;
        index[ib + 9] = vb + 2;
        index[ib + 10] = vb + 5;
        index[ib + 11] = vb + 4;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    return count;
  }

  // Cold rebuild only when the model object actually changes. The model-derived
  // chain re-runs spuriously on every pad hit (same reference, identical data),
  // so guard on identity to keep the geometry build off the hot path.
  let builtCount = 0;
  let builtRef: SerializedModel | null = null;
  $effect(() => {
    const m = model;
    if (m === builtRef) return;
    builtRef = m;
    builtCount = untrack(() => buildGeometry(m, scale));
  });

  // Hot path: push the latest frame's RGB triples onto the per-vertex colours.
  // Each pixel owns VPP coincident-edge vertices, all painted its colour.
  useTask(() => {
    const f = frame;
    const colAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!f || !colAttr || !builtCount) return;
    const colors = colAttr.array as Float32Array;
    const max = Math.min(builtCount, Math.floor(f.length / 3));
    for (let i = 0; i < max; i++) {
      const r = f[i * 3]! / 255;
      const g = f[i * 3 + 1]! / 255;
      const b = f[i * 3 + 2]! / 255;
      const base = i * VPP * 3;
      for (let k = 0; k < VPP; k++) {
        const o = base + k * 3;
        colors[o] = r;
        colors[o + 1] = g;
        colors[o + 2] = b;
      }
    }
    colAttr.needsUpdate = true;
  });
</script>

<T.Mesh geometry={geometry} material={material} frustumCulled={false} />
