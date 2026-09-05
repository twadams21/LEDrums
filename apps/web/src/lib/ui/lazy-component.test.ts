import { describe, expect, it } from 'vitest';
import { attemptOutcome, createLazyHost, failedStyleUrl, lazyComponent, reportedEntryUrl, styleOwner, type LazyEnvironment } from './lazy-component';

const origin = 'http://localhost:4412';
const entry = `${origin}/assets/TriggerGraphView-a_1.js`;

describe('reportedEntryUrl', () => {
  it.each([
    'Failed to fetch dynamically imported module: ',
    'error loading dynamically imported module: ',
    'Importing a module script failed: ',
  ])('recognizes a first-attempt fetch failure of the bare entry: %s', (prefix) => {
    expect(reportedEntryUrl(new TypeError(`${prefix}${entry}`), 'TriggerGraphView', origin, null)).toBe(entry);
  });
  it('on a retry accepts only the exact URL that retry requested', () => {
    const retried = `${entry}?load-retry=3`;
    const error = new TypeError(`Failed to fetch dynamically imported module: ${retried}`);
    expect(reportedEntryUrl(error, 'TriggerGraphView', origin, retried)).toBe(retried);
    expect(reportedEntryUrl(error, 'TriggerGraphView', origin, `${entry}?load-retry=2`)).toBeNull();
    expect(reportedEntryUrl(error, 'TriggerGraphView', origin, null)).toBeNull();
    expect(reportedEntryUrl(new TypeError(`Failed to fetch dynamically imported module: ${entry}`), 'TriggerGraphView', origin, retried)).toBeNull();
  });
  it.each([
    new Error(`Failed to fetch dynamically imported module: ${entry}`),
    new TypeError(`evaluation failed: ${entry}`),
    new TypeError('Failed to fetch dynamically imported module: https://other.test/assets/TriggerGraphView-a.js'),
    new TypeError(`Failed to fetch dynamically imported module: ${origin}/assets/shared-a.js`),
    new TypeError(`Failed to fetch dynamically imported module: ${origin}/other/TriggerGraphView-a.js`),
    new TypeError('Failed to fetch dynamically imported module: http://user@localhost:4412/assets/TriggerGraphView-a.js'),
    new TypeError(`Failed to fetch dynamically imported module: ${entry}?favicon-probe`),
    new TypeError(`Failed to fetch dynamically imported module: ${entry}#x`),
    new TypeError('Importing a module script failed.'),
  ])('does not import arbitrary URLs or guess an opaque failure', (error) => {
    expect(reportedEntryUrl(error, 'TriggerGraphView', origin, null)).toBeNull();
  });
});

describe('attemptOutcome', () => {
  it('reports the witnessed status of the exact attempted URL', () => {
    expect(attemptOutcome(entry, [{ name: entry, responseStatus: 503, initiatorType: 'script', startTime: 5 }], 1)).toEqual({ kind: 'http', status: 503 });
    expect(attemptOutcome(entry, [{ name: entry, responseStatus: 0, initiatorType: 'script', startTime: 5 }], 1)).toEqual({ kind: 'opaque' });
    expect(attemptOutcome(entry, [{ name: entry, responseStatus: 200, initiatorType: 'script', startTime: 5 }], 1)).toEqual({ kind: 'delivered', status: 200 });
  });
  it('has no evidence without a timing entry, a status, or an engine that reports status', () => {
    expect(attemptOutcome(entry, [])).toBeNull();
    expect(attemptOutcome(entry, [{ name: entry, initiatorType: 'script', startTime: 5 }], 1)).toBeNull();
  });
  it('ignores a different query, initiator, origin or an earlier attempt of the same path', () => {
    expect(attemptOutcome(entry, [{ name: `${entry}?favicon-probe`, responseStatus: 0, initiatorType: 'other', startTime: 5 }], 1)).toBeNull();
    expect(attemptOutcome(entry, [{ name: entry, responseStatus: 0, initiatorType: 'other', startTime: 5 }], 1)).toBeNull();
    expect(attemptOutcome(entry, [{ name: entry.replace('localhost', 'other.test'), responseStatus: 0, initiatorType: 'script', startTime: 5 }], 1)).toBeNull();
    expect(attemptOutcome(entry, [{ name: entry, responseStatus: 0, initiatorType: 'script', startTime: 5 }], 6)).toBeNull();
  });
  it('uses the latest request of this attempt', () => {
    expect(attemptOutcome(entry, [
      { name: entry, responseStatus: 0, initiatorType: 'script', startTime: 1 },
      { name: entry, responseStatus: 200, initiatorType: 'script', startTime: 2 },
    ])).toEqual({ kind: 'delivered', status: 200 });
  });
});

describe('stylesheets', () => {
  it('only recognizes a same-origin Vite asset stylesheet, without its query', () => {
    expect(failedStyleUrl(new Error('Unable to preload CSS for /assets/View-ab.css'), origin)).toBe(`${origin}/assets/View-ab.css`);
    expect(failedStyleUrl(new Error(`Unable to preload CSS for ${origin}/assets/graph-thumb-ab.css?load-retry=2`), origin)).toBe(`${origin}/assets/graph-thumb-ab.css`);
    expect(failedStyleUrl(new Error('Unable to preload CSS for https://other.test/assets/View-ab.css'), origin)).toBeNull();
    expect(failedStyleUrl(new Error('Unable to preload CSS for /private.css'), origin)).toBeNull();
    expect(failedStyleUrl(new Error('ordinary failure'), origin)).toBeNull();
  });
  it('attributes an entry-named stylesheet to its boundary and everything else to all boundaries', () => {
    const entries = new Set(['ObjectsView', 'SectionsView']);
    expect(styleOwner(`${origin}/assets/ObjectsView-B96n.css`, entries)).toBe('ObjectsView');
    expect(styleOwner(`${origin}/assets/Field-CvCM.css`, entries)).toBeNull();
    expect(styleOwner(`${origin}/assets/graph-thumb-BXyz.css`, entries)).toBeNull();
  });
});

function nodeHost() {
  const env: LazyEnvironment = {
    origin, document: null, timings: () => [], now: () => 0, online: () => undefined,
    probe: async () => true, onPreloadError: () => {},
  };
  return createLazyHost(env);
}

it('lazyComponent caches the imported default and contains evaluation failures', async () => {
  const host = nodeHost();
  const resource = lazyComponent('View', async () => ({ default: 'View' }), host);
  await resource.load();
  expect(resource.state).toEqual({ status: 'ready', value: 'View' });
  let attempts = 0;
  const failed = lazyComponent('View', async () => { attempts++; throw new SyntaxError('broken module'); }, host);
  await failed.load();
  await failed.retry();
  expect(failed.state).toEqual({ status: 'error', retryable: false });
  expect(attempts).toBe(1);
});
