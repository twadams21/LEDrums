import type { MonitorEvent } from '../ws/protocol-types';

export const MONITOR_RETENTION_LIMIT = 300;

export type MonitorFilterType = MonitorEvent['type'] | 'all';

export interface MonitorFilters {
  type: MonitorFilterType;
  text: string;
  source: string;
  destination: string;
}

export const DEFAULT_MONITOR_FILTERS: MonitorFilters = {
  type: 'all',
  text: '',
  source: '',
  destination: '',
};

export function appendMonitorEvent(
  events: MonitorEvent[],
  event: MonitorEvent,
  limit = MONITOR_RETENTION_LIMIT,
): MonitorEvent[] {
  return [event, ...events].slice(0, limit);
}

export function filterMonitorEvents(events: readonly MonitorEvent[], filters: MonitorFilters): MonitorEvent[] {
  const text = filters.text.trim().toLowerCase();
  const source = filters.source.trim().toLowerCase();
  const destination = filters.destination.trim().toLowerCase();

  return events.filter((event) => {
    if (filters.type !== 'all' && event.type !== filters.type) return false;
    if (source && !event.source.toLowerCase().includes(source)) return false;
    if (destination && !(event.destination ?? '').toLowerCase().includes(destination)) return false;
    if (!text) return true;
    return monitorSearchText(event).includes(text);
  });
}

export function monitorEventRowKey(event: MonitorEvent, index: number): string {
  return `${event.id}:${event.time}:${event.type}:${event.direction}:${event.source}:${event.destination ?? ''}:${index}`;
}

export function monitorSearchText(event: MonitorEvent): string {
  return [event.type, event.direction, event.source, event.destination, event.label, event.detail]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
