import { describe, expect, it } from 'vitest';
import { parseIngestBatch, ValidationError } from '../src/validate';

const goodReport = {
  dedupKey: 'web boom at f',
  envelope: {
    machine: 'rig-1',
    version: '1.0.0',
    engineMode: 'voice',
    platform: 'darwin',
    osRelease: '24.0.0',
    session: 's',
    uptimeMs: 1000,
    origin: 'web',
  },
  message: 'boom',
  stack: 'Error: boom',
  breadcrumbs: [{ time: 1, type: 'input', source: 'ws', label: 'midi' }],
  count: 1,
  firstSeenMs: 1,
  lastSeenMs: 2,
};

describe('parseIngestBatch (#122)', () => {
  it('parses a valid batch and defaults dropped to 0', () => {
    const batch = parseIngestBatch({ reports: [goodReport] });
    expect(batch.reports).toHaveLength(1);
    expect(batch.dropped).toBe(0);
    expect(batch.reports[0]!.stack).toBe('Error: boom');
  });

  it('accepts a missing optional stack', () => {
    const { stack, ...noStack } = goodReport;
    void stack;
    const batch = parseIngestBatch({ reports: [noStack] });
    expect(batch.reports[0]!.stack).toBeUndefined();
  });

  it('rejects a non-object body', () => {
    expect(() => parseIngestBatch(null)).toThrow(ValidationError);
    expect(() => parseIngestBatch('nope')).toThrow(ValidationError);
  });

  it('rejects a missing reports array', () => {
    expect(() => parseIngestBatch({ dropped: 0 })).toThrow(ValidationError);
  });

  it('rejects a missing envelope field', () => {
    const bad = { ...goodReport, envelope: { ...goodReport.envelope, machine: undefined } };
    expect(() => parseIngestBatch({ reports: [bad] })).toThrow(/machine/);
  });

  it('rejects an oversized message (trust boundary — leaked token can annoy, not damage)', () => {
    const bad = { ...goodReport, message: 'x'.repeat(9_000) };
    expect(() => parseIngestBatch({ reports: [bad] })).toThrow(/message/);
  });

  it('rejects too many reports in one batch', () => {
    const reports = Array.from({ length: 501 }, () => goodReport);
    expect(() => parseIngestBatch({ reports })).toThrow(/too many/);
  });

  it('rejects too many breadcrumbs', () => {
    const bad = { ...goodReport, breadcrumbs: Array.from({ length: 51 }, () => ({ time: 1, type: 't', source: 's', label: 'l' })) };
    expect(() => parseIngestBatch({ reports: [bad] })).toThrow(/breadcrumbs/);
  });
});
