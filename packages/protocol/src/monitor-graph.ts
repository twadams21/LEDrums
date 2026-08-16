// The "which graph did the engine just fire" contract, carried on the existing `monitor`
// stream rather than a new message. The server's voice-engine host emits one graph-scoped
// monitor event per fired graph; the web client reads those events back to light the fired
// graph's card. Both sides go through the helpers here so the wire shape has ONE definition —
// a renamed label can no longer silently blind the indicator.

/** The `destination` prefix that scopes a monitor event to a graph key. */
const GRAPH_DESTINATION_PREFIX = 'graph:';
/** The `label` prefix that marks a graph-scoped event as an actual FIRE (not a resolve/reset). */
const GRAPH_FIRED_LABEL = 'Graph fired';

/** `destination` for a monitor event about `graphKey`. */
export function graphMonitorDestination(graphKey: string): string {
  return `${GRAPH_DESTINATION_PREFIX}${graphKey}`;
}

/** `label` for the engine's "this graph fired" monitor event. */
export function graphFiredMonitorLabel(graphKey: string): string {
  return `${GRAPH_FIRED_LABEL} ${graphKey}`;
}

/** The graph key a monitor event reports as FIRED, or null when the event is anything else
    (a resolve, a sequence reset, an input echo, an output frame…). */
export function graphFireKeyOf(event: {
  type: string;
  label: string;
  destination?: string;
}): string | null {
  if (event.type !== 'graph') return null;
  if (!event.destination?.startsWith(GRAPH_DESTINATION_PREFIX)) return null;
  if (!event.label.startsWith(`${GRAPH_FIRED_LABEL} `)) return null;
  const key = event.destination.slice(GRAPH_DESTINATION_PREFIX.length);
  return key || null;
}
