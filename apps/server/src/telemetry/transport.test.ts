import { describe, expect, it, vi } from 'vitest';
import { createHttpTransport } from './transport';

describe('createHttpTransport (#122)', () => {
  it('POSTs reports + dropped with a bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    const transport = createHttpTransport<{ k: string }>({ endpoint: 'https://x/ingest', token: 'tok', fetchFn });
    await transport([{ k: 'a' }], { dropped: 3 });
    expect(fetchFn).toHaveBeenCalledWith('https://x/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
      body: JSON.stringify({ reports: [{ k: 'a' }], dropped: 3 }),
    });
  });

  it('throws on a non-2xx so the queue retains + backs off', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    const transport = createHttpTransport({ endpoint: 'https://x/ingest', token: 'tok', fetchFn });
    await expect(transport([], { dropped: 0 })).rejects.toThrow('429');
  });
});
