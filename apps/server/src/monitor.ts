import type { MonitorEvent, ServerMessage } from './ws-protocol';

export const SERVER_MONITOR_RETENTION_LIMIT = 300;

export type MonitorDraft = Omit<MonitorEvent, 'id' | 'time'>;
export type MonitorJsonSink = (msg: ServerMessage) => void;

export function createMonitorBus(sendAll: MonitorJsonSink, now: () => number = Date.now) {
  let seq = 1;
  let history: MonitorEvent[] = [];

  function emit(draft: MonitorDraft): MonitorEvent {
    const event: MonitorEvent = { id: seq++, time: now(), ...draft };
    history = [event, ...history].slice(0, SERVER_MONITOR_RETENTION_LIMIT);
    sendAll({ t: 'monitor', event });
    return event;
  }

  function replay(sendOne: MonitorJsonSink): void {
    for (const event of [...history].reverse()) sendOne({ t: 'monitor', event });
  }

  return {
    emit,
    replay,
    snapshot: (): MonitorEvent[] => history.slice(),
  };
}
