import { describe, expect, it } from 'vitest';
import { graphFireKeyOf, graphFiredMonitorLabel, graphMonitorDestination } from './monitor-graph';

const fired = (graphKey: string) => ({
  type: 'graph',
  label: graphFiredMonitorLabel(graphKey),
  destination: graphMonitorDestination(graphKey),
});

describe('graphFireKeyOf', () => {
  it('reads back the key the server stamped on a graph-fired event', () => {
    expect(graphFireKeyOf(fired('graph-3'))).toBe('graph-3');
    expect(graphFireKeyOf(fired('kick:0'))).toBe('kick:0');
  });

  it('ignores graph events that are not fires', () => {
    expect(
      graphFireKeyOf({ type: 'graph', label: 'Graph resolved graph-3', destination: 'graph:graph-3' }),
    ).toBeNull();
    expect(
      graphFireKeyOf({ type: 'graph', label: 'Sequence reset graph-3', destination: 'graph:graph-3' }),
    ).toBeNull();
    expect(graphFireKeyOf({ type: 'graph', label: 'No graph resolved' })).toBeNull();
  });

  it('ignores non-graph events and graph-less destinations', () => {
    expect(graphFireKeyOf({ type: 'effect', label: 'Graph fired graph-3', destination: 'graph:graph-3' })).toBeNull();
    expect(graphFireKeyOf({ type: 'graph', label: 'Graph fired graph-3', destination: 'section:s1' })).toBeNull();
    expect(graphFireKeyOf({ type: 'graph', label: 'Graph fired ', destination: 'graph:' })).toBeNull();
  });
});
