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

  // Cross-section of the lit ring (mm): BAND_MM radial (inner→outer radius, in
  // the hoop's plane) × THICK_MM axial (depth along the hoop axis). The axial
  // extrusion gives each segment real body — a thick ring/tube, not a flat
  // ribbon — matching the old box-tube look while now following the curve.
  const BAND_MM = 18;
  const THICK_MM = 20;
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
  // Per pixel: 3 cross-sections (midBefore · center · midAfter), each a 4-corner
  // ring slice (inner/outer × bottom/top) = 12 vertices. Two box segments
  // (B→C, C→A) × 4 walls (outer/inner/top/bottom) × 2 triangles = 16 triangles
  // = 48 index entries. Routing the segment through the pixel's own position
  // keeps the tube curved along the ring; the midpoint cross-sections are shared
  // (coincident, per-pixel-coloured) with neighbours so the joins are gap-free.
  const VPP = 12;
  const IPP = 48;
  // Local vertex indices (0..11) for the 16 triangles, laid out per cross-section
  // as [innerBottom, innerTop, outerBottom, outerTop] → B:0-3, C:4-7, A:8-11.
  const TRIS = [
    // segment B→C: outer, inner, top, bottom
    2, 3, 7, 2, 7, 6, 0, 1, 5, 0, 5, 4, 1, 3, 7, 1, 7, 5, 0, 2, 6, 0, 6, 4,
    // segment C→A: outer, inner, top, bottom
    6, 7, 11, 6, 11, 10, 4, 5, 9, 4, 9, 8, 5, 7, 11, 5, 11, 9, 4, 6, 10, 4, 10, 8,
  ];

  // Unlit segments read as a dark frosted band, not black voids.
  const DARK_R = 0.05;
  const DARK_G = 0.05;
  const DARK_B = 0.07;

  // Geometry + material live for the component's lifetime; the cold build swaps
  // the geometry's attributes in place, the hot path only rewrites colours.
  // vertexColors carries the live RGB frame; DoubleSide keeps every tube wall
  // visible (segments share coincident end faces, so no caps are needed).
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
  // Tangent (along the hoop), same axis swap, normalized.
  function readTan(m: SerializedModel, idx: number, out: number[]): void {
    const j = idx * 3;
    const x = m.tangents[j]!;
    const y = m.tangents[j + 2]!;
    const z = m.tangents[j + 1]!;
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
  // Write one cross-section's 4 corner vertices (12 floats at offset o): the
  // position p offset ±halfR along the in-plane radial n and ±halfT along the
  // hoop axis ax, in order [innerBottom, innerTop, outerBottom, outerTop].
  function corners(
    arr: Float32Array,
    o: number,
    p: number[],
    n: number[],
    ax: number[],
    halfR: number,
    halfT: number,
  ): void {
    for (let c = 0; c < 4; c++) {
      const rs = c < 2 ? -halfR : halfR; // inner (0,1) vs outer (2,3)
      const ts = c % 2 === 0 ? -halfT : halfT; // bottom (0,2) vs top (1,3)
      const q = o + c * 3;
      arr[q] = p[0]! + n[0]! * rs + ax[0]! * ts;
      arr[q + 1] = p[1]! + n[1]! * rs + ax[1]! * ts;
      arr[q + 2] = p[2]! + n[2]! * rs + ax[2]! * ts;
    }
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
    const halfR = BAND_MM / s / 2;
    const halfT = THICK_MM / s / 2;

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
    const tan0: number[] = [0, 0, 0];
    const axis: number[] = [0, 0, 0];

    for (const H of buildHoops(m)) {
      const L = H.length;
      // A hoop is a closed ring when its first and last pixel sit one step apart
      // (a full circle); then prev/next wrap so the ring closes with no seam.
      readPos(m, H[0]!, s, a0);
      readPos(m, H[L - 1]!, s, b0);
      const span = Math.hypot(a0[0]! - b0[0]!, a0[1]! - b0[1]!, a0[2]! - b0[2]!);
      const closed = L > 2 && span <= (HOOP_GAP_K * (m.segmentLengths[H[0]!] || 1)) / s;

      // One axis per hoop (a hoop is planar, so its axis is constant). Using a
      // single axis for every cross-section keeps neighbours' shared end faces
      // exactly coincident → the extruded tube stays watertight around the ring.
      readTan(m, H[0]!, tan0);
      readNrm(m, H[0]!, nC);
      axis[0] = tan0[1]! * nC[2]! - tan0[2]! * nC[1]!;
      axis[1] = tan0[2]! * nC[0]! - tan0[0]! * nC[2]!;
      axis[2] = tan0[0]! * nC[1]! - tan0[1]! * nC[0]!;
      const alen = Math.hypot(axis[0]!, axis[1]!, axis[2]!) || 1;
      axis[0] /= alen;
      axis[1] /= alen;
      axis[2] /= alen;

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
        corners(positions, v + 0, pB, nB, axis, halfR, halfT); // B: verts 0-3
        corners(positions, v + 12, pC, nC, axis, halfR, halfT); // C: verts 4-7
        corners(positions, v + 24, pA, nA, axis, halfR, halfT); // A: verts 8-11

        for (let k = 0; k < VPP; k++) {
          const o = v + k * 3;
          colors[o] = DARK_R;
          colors[o + 1] = DARK_G;
          colors[o + 2] = DARK_B;
        }

        const vb = i * VPP;
        const ib = i * IPP;
        for (let q = 0; q < IPP; q++) index[ib + q] = vb + TRIS[q]!;
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
