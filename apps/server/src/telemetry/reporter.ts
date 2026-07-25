import type { MonitorEvent } from '../ws-protocol';
import type { ShipQueue } from './ship-queue';
import {
  capReport,
  dedupKey,
  type Breadcrumb,
  type Envelope,
  type ReportOrigin,
  type ReportRecord,
} from './envelope';

/**
 * The error Reporter (#122): subscribes to the Monitor bus, turns error events into deduplicated,
 * breadcrumbed reports, and hands them to a generic {@link ShipQueue} for durable, backoff-protected
 * shipping. Built as a pure factory (injected clock, envelope builder, queue) in the style of the
 * autosaver — no singletons, fully testable with fakes.
 *
 * Single entry: {@link Reporter.observe} is called for EVERY emitted Monitor event. Non-error events
 * accumulate in a ring buffer (the breadcrumb trail); an error event snapshots that trail, builds or
 * bumps the report for its dedup key, and enqueues it. Because the queue upserts by dedup key, a
 * render-loop error firing 120×/s collapses to one queued report whose count rises — no flood.
 *
 * Isolation: `observe` never throws (a fault in reporting must not break the bus) and the Reporter
 * NEVER re-emits an error event — its own failures log locally only, so it can't recurse into the
 * stream it reports on.
 */
export interface Reporter {
  /** Feed one Monitor event: accumulates breadcrumbs and, for `error` events, reports. Never throws. */
  observe(event: MonitorEvent): void;
  /** Ship the queue now (shutdown/tests). Never rejects. */
  flush(): Promise<void>;
  /** Synchronous durable write of the queue (crash/shutdown path). */
  persistSync(): void;
  dispose(): void;
}

export interface ReporterDeps {
  /** The durable outbox the Reporter ships through (keyed by dedup key). */
  queue: ShipQueue<ReportRecord>;
  /** Build the identity envelope for a report at the moment it is created (reads live uptime). */
  envelope: (origin: ReportOrigin) => Envelope;
  /** Injected clock. */
  now: () => number;
  /** Breadcrumb ring size (default 20). */
  breadcrumbLimit?: number;
  /** Local-only logger for the Reporter's own faults (default console.error). NEVER the bus. */
  log?: (message: string) => void;
}

/** Which side a Monitor error came from — `web` for browser-forwarded faults, else `server`. */
function originOf(event: MonitorEvent): ReportOrigin {
  return event.source === 'web' ? 'web' : 'server';
}

export function createReporter(deps: ReporterDeps): Reporter {
  const limit = deps.breadcrumbLimit ?? 20;
  const log = deps.log ?? ((m: string): void => console.error(m));
  // Per-session dedup registry: the record accumulates count across ship cycles.
  const records = new Map<string, ReportRecord>();
  const ring: Breadcrumb[] = [];

  return {
    observe(event: MonitorEvent): void {
      try {
        if (event.type === 'error') {
          const origin = originOf(event);
          const key = dedupKey({ origin, message: event.label, stack: event.detail });
          const now = deps.now();
          let rec = records.get(key);
          if (!rec) {
            rec = {
              dedupKey: key,
              envelope: deps.envelope(origin),
              message: event.label,
              stack: event.detail,
              // First occurrence keeps the trail leading UP TO the fault (events before this one).
              breadcrumbs: ring.slice(),
              count: 0,
              firstSeenMs: now,
              lastSeenMs: now,
            };
            records.set(key, rec);
          }
          rec.count++;
          rec.lastSeenMs = now;
          // Enqueue a capped copy; the queue's upsert-by-dedupKey collapses repeats to one entry.
          deps.queue.enqueue(capReport(rec));
        }
        // Every event (all types) becomes a breadcrumb for SUBSEQUENT errors.
        ring.push({ time: event.time, type: event.type, source: event.source, label: event.label });
        if (ring.length > limit) ring.shift();
      } catch (err) {
        log(`[reporter] observe failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    flush: () => deps.queue.flush(),
    persistSync: () => deps.queue.persistSync(),
    dispose: () => deps.queue.dispose(),
  };
}
