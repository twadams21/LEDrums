/* The dataTransfer contract for dragging a hoop — written by the pool chips and the chain
   rows, read by whichever chain (or the pool) it is dropped on. Kept out of the components
   because both ends must agree on it, and because "what a drop means" is testable prose,
   not a DOM concern.

   Why a MIME type and not a module-level variable: a `dragover` handler is not allowed to
   READ dataTransfer (protected mode) — it can only see the type list. Carrying our payload
   under our own MIME lets a target decide "this is a hoop, I accept it" mid-drag, and keeps
   a file or a text selection dragged in from elsewhere from being mistaken for one. */

import type { HoopDrag } from './chain-editor';

export const HOOP_MIME = 'application/x-ledrums-hoop';

/** The bits of `DataTransfer` this contract needs — structural, so the rules can be tested
    without a DOM (jsdom's DataTransfer is a stub). */
export interface DragPayloadCarrier {
  setData(format: string, data: string): void;
  getData(format: string): string;
  readonly types: readonly string[];
}

export function writeHoopDrag(dt: DragPayloadCarrier | null, drag: HoopDrag): void {
  dt?.setData(HOOP_MIME, JSON.stringify(drag));
}

/** True when the in-flight drag is one of ours — safe to call during `dragover`. */
export function isHoopDrag(dt: DragPayloadCarrier | null): boolean {
  return dt ? Array.from(dt.types).includes(HOOP_MIME) : false;
}

/** The drag payload, or `null` when this is not our drag or the payload is malformed —
    a drop is a mutation, so anything unrecognised is dropped on the floor rather than
    guessed at. */
export function readHoopDrag(dt: DragPayloadCarrier | null): HoopDrag | null {
  if (!dt) return null;
  const raw = dt.getData(HOOP_MIME);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const drag = parsed as HoopDrag;
  if (!drag || typeof drag !== 'object') return null;
  const { hoop, from } = drag;
  if (!hoop || typeof hoop.drumId !== 'string' || !Number.isInteger(hoop.hoop)) return null;
  if (from !== null && (typeof from?.outputId !== 'string' || !Number.isInteger(from?.index))) return null;
  return { hoop: { drumId: hoop.drumId, hoop: hoop.hoop }, from: from === null ? null : { ...from } };
}
