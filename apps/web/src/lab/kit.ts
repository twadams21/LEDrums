/**
 * kit.ts — the real LED drum kit, as flat arrays in LAB WORLD SPACE.   (FOUNDATION-OWNED, stable)
 *
 * CONTRACT
 *  - Source of truth is @ledrums/core: buildPixelModel(DEFAULT_KIT). Core is millimetres, Z-up.
 *  - Lab world space is METRES, Y-up (three.js convention): lab = (x, z, -y) / 1000, then the whole
 *    kit is translated so the CENTRE OF THE KIT BOUNDS is the world origin.
 *  - `kit` is built once at module load; it is immutable data. Nothing here touches the GPU.
 *
 * EXPORTS
 *  kit: KitInfo
 *    .ledCount            number of LEDs (~2k)
 *    .ledPositions        Float32Array, length ledCount*3, xyz metres (lab space), core pixel-id order
 *    .ledDrum             Uint8Array, length ledCount, drum index (0..drums.length-1) per LED
 *    .drums               KitDrum[]  (kick, snare, tom1, tom2)
 *    .drumIds             string[]   same order as drums
 *    .bounds              { min, max, size, radius }  LED bounds in lab space (already centred; radius = half diagonal)
 *    .domainHalfExtent    [hx,hy,hz] half-size (m) of the box the particle world lives in, centred on origin
 *    .hoopSegments        Float32Array of xyz pairs (line segments) tracing every hoop, for LineSegments
 *  KitDrum { id, label, color (css hex), index, center:[x,y,z] (lab m), radius (m), ledStart, ledCount, hoopCount }
 *  drumIndex(id): number | -1
 *  createHoopLines(color?, opacity?): LineSegments   faint hoop wireframe (three/webgpu material)
 */
import { DEFAULT_KIT, buildPixelModel } from '@ledrums/core';
import { BufferGeometry, Float32BufferAttribute, LineBasicNodeMaterial, LineSegments } from 'three/webgpu';

export interface KitDrum {
  id: string;
  label: string;
  color: string;
  index: number;
  center: [number, number, number];
  radius: number;
  ledStart: number;
  ledCount: number;
  hoopCount: number;
}

export interface KitInfo {
  ledCount: number;
  ledPositions: Float32Array;
  ledDrum: Uint8Array;
  drums: KitDrum[];
  drumIds: string[];
  bounds: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number]; radius: number };
  domainHalfExtent: [number, number, number];
  hoopSegments: Float32Array;
}

const MM = 1 / 1000;

function buildKit(): KitInfo {
  const model = buildPixelModel(DEFAULT_KIT);
  const n = model.pixels.length;

  // core (mm, Z-up) -> lab (m, Y-up), pre-centring
  const raw = new Float32Array(n * 3);
  const mn: [number, number, number] = [Infinity, Infinity, Infinity];
  const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const w = model.pixels[i]!.world;
    const x = w.x * MM;
    const y = w.z * MM;
    const z = -w.y * MM;
    raw[i * 3] = x;
    raw[i * 3 + 1] = y;
    raw[i * 3 + 2] = z;
    if (x < mn[0]) mn[0] = x;
    if (y < mn[1]) mn[1] = y;
    if (z < mn[2]) mn[2] = z;
    if (x > mx[0]) mx[0] = x;
    if (y > mx[1]) mx[1] = y;
    if (z > mx[2]) mx[2] = z;
  }
  const c: [number, number, number] = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];

  const ledPositions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    ledPositions[i * 3] = raw[i * 3]! - c[0];
    ledPositions[i * 3 + 1] = raw[i * 3 + 1]! - c[1];
    ledPositions[i * 3 + 2] = raw[i * 3 + 2]! - c[2];
  }
  const size: [number, number, number] = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const bounds = {
    min: [mn[0] - c[0], mn[1] - c[1], mn[2] - c[2]] as [number, number, number],
    max: [mx[0] - c[0], mx[1] - c[1], mx[2] - c[2]] as [number, number, number],
    size,
    radius: Math.hypot(size[0], size[1], size[2]) / 2,
  };

  const ledDrum = new Uint8Array(n);
  const drums: KitDrum[] = model.drums.map((d, index) => {
    for (let i = d.pixelStart; i < d.pixelStart + d.pixelCount; i++) ledDrum[i] = index;
    const o = d.effectOriginWorld;
    return {
      id: d.drumId,
      label: d.label,
      color: d.color,
      index,
      center: [o.x * MM - c[0], o.z * MM - c[1], -o.y * MM - c[2]],
      radius: d.radiusMm * MM,
      ledStart: d.pixelStart,
      ledCount: d.pixelCount,
      hoopCount: d.hoopCount,
    };
  });

  // Hoop outlines: consecutive pixels within the same (drum, hoop), closed into a loop.
  const seg: number[] = [];
  const groups = new Map<string, number[]>();
  for (const p of model.pixels) {
    const key = `${p.drumId}:${p.hoopIndex}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(p.id);
  }
  for (const ids of groups.values()) {
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k]!;
      const b = ids[(k + 1) % ids.length]!;
      seg.push(
        ledPositions[a * 3]!, ledPositions[a * 3 + 1]!, ledPositions[a * 3 + 2]!,
        ledPositions[b * 3]!, ledPositions[b * 3 + 1]!, ledPositions[b * 3 + 2]!,
      );
    }
  }

  const half = (s: number) => Math.max(1.0, s * 0.8);
  return {
    ledCount: n,
    ledPositions,
    ledDrum,
    drums,
    drumIds: drums.map((d) => d.id),
    bounds,
    domainHalfExtent: [half(size[0]), half(size[1]), half(size[2])],
    hoopSegments: new Float32Array(seg),
  };
}

export const kit: KitInfo = buildKit();

export function drumIndex(id: string): number {
  return kit.drumIds.indexOf(id);
}

export function createHoopLines(color = 0x3a4a63, opacity = 0.55): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(kit.hoopSegments, 3));
  const mat = new LineBasicNodeMaterial({ color, transparent: true, opacity, depthWrite: false });
  const lines = new LineSegments(geo, mat);
  lines.frustumCulled = false;
  return lines;
}
