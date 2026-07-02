/* Error boundary for the graph editors' @xyflow/svelte event callbacks. An uncaught throw
   inside a connect / reconnect / connect-end / drag / delete handler propagates into xyflow's
   internals and breaks Svelte's effect tracking — the node array freezes and the canvas blanks
   until a page refresh (trigger-graph "blank nodes" incident 09, candidate 2). Wrapping every
   callback routes a throw to `onFault` instead, so the view can surface it (a Monitor `error`
   event) and self-heal (force a clean projection rebuild). Pure + framework-free so the
   boundary contract is unit-tested directly, without driving xyflow. */

/** Wrap a graph event callback so a throw is caught and handed to `onFault(where, err)` rather
    than propagating. Returns a callback with the SAME parameters as `fn`; each invocation is
    isolated (a throw on one call never blocks a later successful call). `where` names the
    callback (e.g. `connect`) for the fault report. */
export function guardFlowCallback<A extends unknown[]>(
  where: string,
  fn: (...args: A) => void,
  onFault: (where: string, err: unknown) => void,
): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      onFault(where, err);
    }
  };
}
