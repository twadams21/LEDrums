import type { ReportRow, WireReport } from '../src/types';

export function wire(dedupKey = 'boom', session = 's1', machine = 'rig-1'): WireReport {
  return {
    dedupKey, message: 'boom', breadcrumbs: [], count: 1, firstSeenMs: 10, lastSeenMs: 20,
    envelope: { machine, session, version: '1', engineMode: 'voice', platform: 'darwin',
      osRelease: '24', uptimeMs: 100, origin: 'web' },
  };
}

export function row(receivedAt = 1_000_000, dedupKey = 'boom', session = 's1'): ReportRow {
  const report = wire(dedupKey, session);
  return { ...report.envelope, dedupKey, message: report.message, breadcrumbs: [], stack: null,
    count: report.count, firstSeenMs: report.firstSeenMs, lastSeenMs: report.lastSeenMs, receivedAt };
}
