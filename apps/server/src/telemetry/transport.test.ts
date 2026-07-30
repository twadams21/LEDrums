import { describe, expect, it, vi } from 'vitest';
import { createHttpTransport, isRetryableStatus, ShipHttpError } from './transport';

const rejectionFor = async (status: number): Promise<ShipHttpError> => {
  const fetchFn = vi.fn().mockResolvedValue({ ok: false, status } as Response);
  const transport = createHttpTransport({ endpoint: 'https://x/ingest', token: 'tok', fetchFn });
  return await transport([], { dropped: 0 }).then(
    () => {
      throw new Error(`expected ${status} to reject`);
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(ShipHttpError);
      return err as ShipHttpError;
    },
  );
};

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
    // The message stays byte-identical to the untyped Error this replaced...
    await expect(transport([], { dropped: 0 })).rejects.toThrow('429');
    // ...and now additionally carries the status class the queue decides on.
    const err = await rejectionFor(429);
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
  });

  it('classifies a rejection as transient or permanent by status', async () => {
    // Permanent: a rotated token and a malformed/oversized batch will fail identically forever.
    expect(await rejectionFor(401)).toMatchObject({ status: 401, retryable: false });
    expect(await rejectionFor(400)).toMatchObject({ status: 400, retryable: false });
    expect(await rejectionFor(413)).toMatchObject({ status: 413, retryable: false });
    // Transient: the Worker's own S1 fault-boundary 503 must read as retryable.
    expect(await rejectionFor(503)).toMatchObject({ status: 503, retryable: true });
  });
});

describe('isRetryableStatus (#137 INIT-11 S2)', () => {
  it('splits at the 4xx/5xx boundary, with 408 and 429 as the transient 4xx exceptions', () => {
    expect(isRetryableStatus(499)).toBe(false);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
  });
});
