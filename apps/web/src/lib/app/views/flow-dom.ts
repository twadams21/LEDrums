/* Tiny DOM helper for the @xyflow/svelte graphs. xyflow's connection `toNode` is only
   reported when a wire is released over (or within the connection radius of) a handle —
   not over a node's body. To accept a wire dropped ANYWHERE on a node, hit-test the
   element under the release point and walk up to its node wrapper (`data-id` on
   `.svelte-flow__node`). Mirrors the old hand-rolled canvas's drop hit-test. */

/** The id of the xyflow node under a mouse/touch event, or null. */
export function nodeIdAtEvent(event: MouseEvent | TouchEvent): string | null {
  const pt = 'changedTouches' in event ? event.changedTouches[0] : event;
  if (!pt) return null;
  const el = document.elementFromPoint(pt.clientX, pt.clientY);
  const nodeEl = el instanceof Element ? el.closest('.svelte-flow__node') : null;
  return nodeEl?.getAttribute('data-id') ?? null;
}
