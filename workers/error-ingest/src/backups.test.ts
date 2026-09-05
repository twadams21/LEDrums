import { describe, expect, it, vi } from 'vitest';
import { r2Store } from './backups';
import type { R2Bucket } from './cf';

describe('r2Store.list', () => {
  it('follows every cursor before sorting, including when the newest upload is on the last page', async () => {
    const list = vi.fn<R2Bucket['list']>()
      .mockResolvedValueOnce({
        objects: [{ key: 'backups/studio-mac/a', size: 10, uploaded: new Date(1000) }],
        truncated: true,
        cursor: 'next-page',
      })
      .mockResolvedValueOnce({ objects: [], truncated: true, cursor: 'last-page' })
      .mockResolvedValueOnce({
        objects: [{ key: 'backups/studio-mac/z', size: 20, uploaded: new Date(3000) }],
        truncated: false,
      });
    const bucket: R2Bucket = {
      list,
      put: vi.fn<R2Bucket['put']>(),
      get: vi.fn<R2Bucket['get']>(),
    };

    expect(await r2Store(bucket).list('studio-mac')).toEqual([
      { key: 'backups/studio-mac/z', size: 20, uploaded: 3000 },
      { key: 'backups/studio-mac/a', size: 10, uploaded: 1000 },
    ]);
    expect(list.mock.calls).toEqual([
      [{ prefix: 'backups/studio-mac/' }],
      [{ prefix: 'backups/studio-mac/', cursor: 'next-page' }],
      [{ prefix: 'backups/studio-mac/', cursor: 'last-page' }],
    ]);
  });

  it('returns an empty listing without following a cursor when the response is not truncated', async () => {
    const list = vi.fn<R2Bucket['list']>().mockResolvedValue({
      objects: [], truncated: false, cursor: 'unused',
    });
    const bucket: R2Bucket = {
      list,
      put: vi.fn<R2Bucket['put']>(),
      get: vi.fn<R2Bucket['get']>(),
    };

    expect(await r2Store(bucket).list('other')).toEqual([]);
    expect(list.mock.calls).toEqual([[{ prefix: 'backups/other/' }]]);
  });
});
