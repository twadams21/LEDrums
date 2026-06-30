import { describe, expect, it } from 'vitest';
import { createMonitorBus, SERVER_MONITOR_RETENTION_LIMIT, type MonitorDraft } from './monitor';
import type { ServerMessage } from './ws-protocol';

const draft = (label: string): MonitorDraft => ({
  type: 'system',
  direction: 'local',
  source: 'test',
  label,
});

describe('createMonitorBus', () => {
  it('assigns monotonically increasing ids and times', () => {
    const sent: ServerMessage[] = [];
    let now = 100;
    const bus = createMonitorBus((msg) => sent.push(msg), () => now++);

    const a = bus.emit(draft('a'));
    const b = bus.emit(draft('b'));

    expect(a).toMatchObject({ id: 1, time: 100, label: 'a' });
    expect(b).toMatchObject({ id: 2, time: 101, label: 'b' });
    expect(sent.map((m) => (m.t === 'monitor' ? m.event.id : 0))).toEqual([1, 2]);
  });

  it('keeps retained history bounded newest-first', () => {
    const bus = createMonitorBus(() => {}, () => 1);
    for (let i = 0; i < SERVER_MONITOR_RETENTION_LIMIT + 5; i += 1) bus.emit(draft(`e${i}`));

    const snapshot = bus.snapshot();
    expect(snapshot).toHaveLength(SERVER_MONITOR_RETENTION_LIMIT);
    expect(snapshot[0]!.label).toBe(`e${SERVER_MONITOR_RETENTION_LIMIT + 4}`);
    expect(snapshot.at(-1)!.label).toBe('e5');
  });

  it('replays retained events oldest-first without mutating history', () => {
    const bus = createMonitorBus(() => {}, () => 1);
    bus.emit(draft('a'));
    bus.emit(draft('b'));
    bus.emit(draft('c'));
    const before = bus.snapshot();
    const replayed: ServerMessage[] = [];

    bus.replay((msg) => replayed.push(msg));

    expect(replayed.map((m) => (m.t === 'monitor' ? m.event.label : ''))).toEqual(['a', 'b', 'c']);
    expect(bus.snapshot()).toEqual(before);
  });
});
