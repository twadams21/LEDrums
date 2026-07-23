/* Undo resync for the authoritative Project slice (Patch graph: routing / geometry / IO). The
   project mutators optimistic-write `project` AND forward a granular edit over WS; undo restores
   an earlier `project` locally, so the engine must be told what to re-apply to converge. This
   PURE helper diffs the live project against the restored one and emits ONLY the granular
   client messages whose slice actually changed — the same messages the mutators send — so an
   undo re-sends `setKitOutputs` / `setKitTransform` / `setKitGlobal` / `setInputMap` / `setOutput`
   without hammering the engine with the slices that did not move. No runes/DOM here. */

import type { Project } from '@ledrums/core';
import type { ClientMessage } from '../../ws/protocol-types';

/** Structural equality for the plain JSON-safe Project slices (no functions/proxies). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** The transform-carrier fields `setKitTransform` merges onto a drum (mirrors the message). */
function drumTransform(drum: Project['kit']['drums'][number]) {
  return {
    origin: drum.origin,
    rotation: drum.rotation,
    localSpinDeg: drum.localSpinDeg,
    startAngleDeg: drum.startAngleDeg,
    pixelsPerHoop: drum.pixelsPerHoop,
    hoopSpacingMm: drum.hoopSpacingMm,
    diameterIn: drum.diameterIn,
    flip: drum.flip,
  };
}

/**
 * The granular WS messages that re-apply `restored` over `live` on the engine — one per changed
 * slice, in kit → input → output order. Empty when the two projects match (a trigger-graph undo
 * that never touched the project), so trigger-only undos send nothing. A null `restored` (undo to
 * an offline state) emits nothing — there is no project to converge to.
 */
export function projectResyncMessages(live: Project | null, restored: Project | null): ClientMessage[] {
  if (!restored) return [];
  const msgs: ClientMessage[] = [];
  const liveKit = live?.kit;

  for (const drum of restored.kit.drums) {
    const prev = liveKit?.drums.find((d) => d.id === drum.id);
    if (!prev || !deepEqual(drumTransform(prev), drumTransform(drum))) {
      msgs.push({ t: 'setKitTransform', drumId: drum.id, ...drumTransform(drum) });
    }
  }
  // Kit-global resync. `expanded` MUST be carried alongside `mirror`: it is the sole driver of the
  // output-port count, so an undo across the Expanded toggle has to re-apply it BEFORE setKitOutputs
  // — otherwise the engine reconciles the restored outputs against the wrong mode and the count
  // drifts right back (the exact defect the static-output rig kills). Only the fields that actually
  // moved are sent, so a plain mirror edit still emits `{ mirror }` alone.
  const globalPartial: { mirror?: Project['kit']['global']['mirror']; expanded?: boolean } = {};
  if (!liveKit || liveKit.global.mirror !== restored.kit.global.mirror) {
    globalPartial.mirror = restored.kit.global.mirror;
  }
  if (!liveKit || liveKit.global.expanded !== restored.kit.global.expanded) {
    globalPartial.expanded = restored.kit.global.expanded;
  }
  if (Object.keys(globalPartial).length > 0) {
    msgs.push({ t: 'setKitGlobal', ...globalPartial });
  }
  if (!liveKit || !deepEqual(liveKit.outputs, restored.kit.outputs)) {
    msgs.push({ t: 'setKitOutputs', outputs: restored.kit.outputs });
  }
  if (!live || !deepEqual(live.inputMap, restored.inputMap)) {
    msgs.push({ t: 'setInputMap', inputMap: restored.inputMap });
  }
  if (!live || !deepEqual(live.output, restored.output)) {
    msgs.push({ t: 'setOutput', ...restored.output });
  }
  return msgs;
}
