import { describe, expect, it } from 'vitest';
import { entryFetchFailed, failedEntryUrl, failedStyleUrl, lazyComponent } from './lazy-component';

describe('failedEntryUrl', () => {
  const origin = 'http://localhost:4412';
  it.each([
    'Failed to fetch dynamically imported module: ',
    'error loading dynamically imported module: ',
    'Importing a module script failed: ',
  ])('recognizes reported fetch failures: %s', (prefix) => {
    expect(failedEntryUrl(new TypeError(`${prefix}${origin}/assets/TriggerGraphView-a_1.js?load-retry=3`), 'TriggerGraphView', origin))
      .toBe(`${origin}/assets/TriggerGraphView-a_1.js`);
  });
  it.each([
    new Error('Failed to fetch dynamically imported module: http://localhost:4412/assets/TriggerGraphView-a.js'),
    new TypeError('evaluation failed: http://localhost:4412/assets/TriggerGraphView-a.js'),
    new TypeError('Failed to fetch dynamically imported module: https://other.test/assets/TriggerGraphView-a.js'),
    new TypeError('Failed to fetch dynamically imported module: http://localhost:4412/assets/shared-a.js'),
    new TypeError('Failed to fetch dynamically imported module: http://localhost:4412/other/TriggerGraphView-a.js'),
    new TypeError('Failed to fetch dynamically imported module: http://user@localhost:4412/assets/TriggerGraphView-a.js'),
    new TypeError('Importing a module script failed.'),
  ])('does not import arbitrary URLs or guess an opaque failure', (error) => {
    expect(failedEntryUrl(error, 'TriggerGraphView', origin)).toBeNull();
  });
});

describe('entryFetchFailed', () => {
  const url = 'http://localhost:4412/assets/TriggerGraphView-a.js';
  it.each([0, 404, 503])('permits recovery with actual failed HTTP evidence (%s)', (responseStatus) => {
    expect(entryFetchFailed(url, [{ name: url, responseStatus }])).toBe(true);
  });
  it('refuses a downloaded entry, missing timing evidence, and a different origin', () => {
    expect(entryFetchFailed(url, [{ name: url, responseStatus: 200 }])).toBe(false);
    expect(entryFetchFailed(url, [{ name: url }])).toBe(false);
    expect(entryFetchFailed(url, [])).toBe(false);
    expect(entryFetchFailed(url, [{ name: url.replace('localhost', 'other.test'), responseStatus: 0 }])).toBe(false);
  });
  it('uses the latest request, including explicit retries', () => {
    expect(entryFetchFailed(url, [
      { name: url, responseStatus: 0 }, { name: `${url}?load-retry=1`, responseStatus: 200 },
    ])).toBe(false);
    expect(entryFetchFailed(url, [
      { name: url, responseStatus: 0 }, { name: `${url}?load-retry=1`, responseStatus: 503 },
    ])).toBe(true);
  });
});

it('only retries a same-origin Vite stylesheet preload failure', () => {
  const origin = 'http://localhost:4412';
  expect(failedStyleUrl(new Error('Unable to preload CSS for /assets/View-ab.css'), origin))
    .toBe(`${origin}/assets/View-ab.css`);
  expect(failedStyleUrl(new Error('Unable to preload CSS for https://other.test/assets/View-ab.css'), origin)).toBeNull();
  expect(failedStyleUrl(new Error('Unable to preload CSS for /private.css'), origin)).toBeNull();
  expect(failedStyleUrl(new Error('ordinary failure'), origin)).toBeNull();
});

it('lazyComponent caches the imported default and contains evaluation failures', async () => {
  const resource = lazyComponent('View', async () => ({ default: 'View' }));
  await resource.load();
  expect(resource.state).toEqual({ status: 'ready', value: 'View' });
  let attempts = 0;
  const failed = lazyComponent('View', async () => { attempts++; throw new SyntaxError('broken module'); });
  await failed.load();
  await failed.retry();
  expect(failed.state).toEqual({ status: 'error', retryable: false });
  expect(attempts).toBe(1);
});
