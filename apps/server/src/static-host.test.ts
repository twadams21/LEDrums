import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_ROOT, resolveWebRoot } from './static-host';

describe('resolveWebRoot (S4 env override)', () => {
  // The packaged desktop shell sets LEDRUMS_WEB_ROOT to its bundled web dist (the in-repo
  // DEFAULT_WEB_ROOT path does not exist inside a packaged binary). An explicit value wins,
  // resolved to an absolute path.
  it('honors an explicit LEDRUMS_WEB_ROOT, resolved to absolute', () => {
    expect(resolveWebRoot({ LEDRUMS_WEB_ROOT: '/opt/ledrums/web' })).toBe('/opt/ledrums/web');
  });

  it('resolves a relative override against the cwd', () => {
    expect(resolveWebRoot({ LEDRUMS_WEB_ROOT: 'some/web/dist' })).toBe(resolve('some/web/dist'));
  });

  // Unset → DEFAULT_WEB_ROOT (apps/web/dist) so plain dev/start is unchanged.
  it('falls back to DEFAULT_WEB_ROOT when unset', () => {
    expect(resolveWebRoot({})).toBe(DEFAULT_WEB_ROOT);
  });

  // A blank/whitespace value is treated as unset.
  it('treats a blank override as unset', () => {
    expect(resolveWebRoot({ LEDRUMS_WEB_ROOT: '  ' })).toBe(DEFAULT_WEB_ROOT);
  });
});
