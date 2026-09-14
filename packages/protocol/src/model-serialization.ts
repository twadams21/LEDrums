import type { DrumInfo, PixelModel } from '@ledrums/core';
import type { SerializedDrum, SerializedModel } from './index';

type Stage = NonNullable<SerializedDrum['stage']>;
type Vector = Stage['origin'];

const UNIT_TOLERANCE = 1e-6;

function isUnit(v: Vector): boolean {
  return v.every(Number.isFinite) && Math.abs(Math.hypot(...v) - 1) <= UNIT_TOLERANCE;
}

function dot(a: Vector, b: Vector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Recover the physical body frame, not the angular phase of the LED strip. */
function serializeStage(model: PixelModel, drum: DrumInfo): Stage | undefined {
  const counts = drum.hoopPixelCounts;
  if (
    counts.length < 2 || counts.length !== drum.hoopCount ||
    !Number.isFinite(drum.radiusMm) || drum.radiusMm <= 0 ||
    !Number.isInteger(drum.pixelStart) || drum.pixelStart < 0
  ) return undefined;

  // Mixed hoop counts are authoritative. Never stride by the lossy pixelsPerHoop field.
  let end = drum.pixelStart;
  let lastStart = end;
  for (const count of counts) {
    if (!Number.isInteger(count) || count <= 0) return undefined;
    lastStart = end;
    end += count;
  }
  if (end - drum.pixelStart !== drum.pixelCount || end > model.pixelCount) return undefined;
  const first = model.pixels[drum.pixelStart];
  const last = model.pixels[lastStart];
  if (
    !first || !last || first.drumId !== drum.drumId || last.drumId !== drum.drumId ||
    !Number.isFinite(first.angleDeg) || !Number.isFinite(first.local.z) ||
    !Number.isFinite(last.local.z) || first.local.z === last.local.z
  ) return undefined;

  const n: Vector = [first.normal.x, first.normal.y, first.normal.z];
  const t: Vector = [first.tangent.x, first.tangent.y, first.tangent.z];
  const lastNormal: Vector = [last.normal.x, last.normal.y, last.normal.z];
  if (!isUnit(n) || !isUnit(t) || !isUnit(lastNormal) || Math.abs(dot(n, t)) > UNIT_TOLERANCE) {
    return undefined;
  }

  const radiusMm = drum.radiusMm;
  const firstCentre: Vector = [
    first.world.x - n[0] * radiusMm,
    first.world.y - n[1] * radiusMm,
    first.world.z - n[2] * radiusMm,
  ];
  const lastCentre: Vector = [
    last.world.x - lastNormal[0] * radiusMm,
    last.world.y - lastNormal[1] * radiusMm,
    last.world.z - lastNormal[2] * radiusMm,
  ];
  const delta: Vector = [
    lastCentre[0] - firstCentre[0],
    lastCentre[1] - firstCentre[1],
    lastCentre[2] - firstCentre[2],
  ];
  const span = Math.hypot(...delta);
  if (!Number.isFinite(span) || span <= 0) return undefined;

  const angle = first.angleDeg * (Math.PI / 180);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x: Vector = [n[0] * c - t[0] * s, n[1] * c - t[1] * s, n[2] * c - t[2] * s];
  // Core flip negates the sweep and local Z, but n/t still describe the raw XY frame.
  // Flip physical Y with Z (a body rotation), independently of start angle/spin/reverse.
  const flipY = first.local.z > 0 ? -1 : 1;
  const y: Vector = [
    (n[0] * s + t[0] * c) * flipY,
    (n[1] * s + t[1] * c) * flipY,
    (n[2] * s + t[2] * c) * flipY,
  ];
  const xLength = Math.hypot(...x);
  const yLength = Math.hypot(...y);
  const xAxis: Vector = [x[0] / xLength, x[1] / xLength, x[2] / xLength];
  const yAxis: Vector = [y[0] / yLength, y[1] / yLength, y[2] / yLength];
  // Do NOT use X × Y: a world mirror must retain its reflected (left-handed) frame.
  const zAxis: Vector = [delta[0] / span, delta[1] / span, delta[2] / span];
  const origin: Vector = [
    firstCentre[0] / 2 + lastCentre[0] / 2,
    firstCentre[1] / 2 + lastCentre[1] / 2,
    firstCentre[2] / 2 + lastCentre[2] / 2,
  ];
  if (
    !origin.every(Number.isFinite) || !isUnit(xAxis) || !isUnit(yAxis) || !isUnit(zAxis) ||
    Math.abs(dot(xAxis, zAxis)) > UNIT_TOLERANCE || Math.abs(dot(yAxis, zAxis)) > UNIT_TOLERANCE
  ) return undefined;

  return { origin, xAxis, yAxis, zAxis, radiusMm, hoopSpacingMm: span / (counts.length - 1), hoopPixelCounts: [...counts] };
}

/** Pure shared wire/offline serialization, once per model rebuild. LED data is copied verbatim;
 * optional Stage metadata is omitted when the model cannot supply a valid physical body frame. */
export function serializePixelModel(model: PixelModel): SerializedModel {
  const positions: number[] = new Array(model.pixelCount * 3);
  const tangents: number[] = new Array(model.pixelCount * 3);
  const normals: number[] = new Array(model.pixelCount * 3);
  const segmentLengths: number[] = new Array(model.pixelCount);
  for (let i = 0; i < model.pixelCount; i++) {
    const p = model.pixels[i]!;
    positions[i * 3] = p.world.x;
    positions[i * 3 + 1] = p.world.y;
    positions[i * 3 + 2] = p.world.z;
    tangents[i * 3] = p.tangent.x;
    tangents[i * 3 + 1] = p.tangent.y;
    tangents[i * 3 + 2] = p.tangent.z;
    normals[i * 3] = p.normal.x;
    normals[i * 3 + 1] = p.normal.y;
    normals[i * 3 + 2] = p.normal.z;
    segmentLengths[i] = p.segmentLengthMm;
  }
  return {
    count: model.pixelCount,
    positions,
    tangents,
    normals,
    segmentLengths,
    drums: model.drums.map((d) => {
      const stage = serializeStage(model, d);
      return {
        id: d.drumId, label: d.label, color: d.color, pixelStart: d.pixelStart, pixelCount: d.pixelCount,
        ...(stage ? { stage } : {}),
      };
    }),
    bounds: { center: [model.bounds.center.x, model.bounds.center.y, model.bounds.center.z], size: model.bounds.size },
  };
}
