import { describe, expect, it } from 'vitest';
import type { MonitorEvent } from '../ws/protocol-types';
import { appendMonitorEvent, filterMonitorEvents } from './monitor';

function event(id: number, overrides: Partial<MonitorEvent> = {}): MonitorEvent {
  return {
    id,
    time: id,
    type: 'input',
    direction: 'in',
    source: 'web',
    label: `event ${id}`,
    ...overrides,
  };
}

describe('monitor event retention', () => {
  it('prepends new events and enforces the retention limit', () => {
    const events = [event(1), event(2)];
    expect(appendMonitorEvent(events, event(3), 2).map((e) => e.id)).toEqual([3, 1]);
  });
});

describe('monitor event filters', () => {
  const events = [
    event(1, { type: 'input', source: 'web', destination: 'server', label: 'MIDI note 60' }),
    event(2, { type: 'output', source: 'server', destination: 'artnet:192.168.1.50', label: 'Art-Net packet' }),
    event(3, { type: 'persistence', source: 'server', destination: 'project', label: 'Saved show' }),
    event(4, { type: 'error', source: 'server', label: 'Startup failed', detail: 'bad project' }),
  ];

  it('filters by taxonomy type', () => {
    expect(filterMonitorEvents(events, { type: 'persistence', text: '', source: '', destination: '' })).toEqual([
      events[2],
    ]);
  });

  it('filters by source, destination, and free text', () => {
    expect(filterMonitorEvents(events, { type: 'all', source: 'server', destination: 'artnet', text: 'packet' })).toEqual([
      events[1],
    ]);
  });

  it('searches label and detail fields', () => {
    expect(filterMonitorEvents(events, { type: 'all', source: '', destination: '', text: 'bad project' })).toEqual([
      events[3],
    ]);
  });
});
