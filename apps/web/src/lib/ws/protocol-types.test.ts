import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeServer } from './protocol-types';

describe('decodeServer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null and warns (dev) when a known server type fails validation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `t: 'state'` is a known server discriminant, but the payload is missing required fields.
    const out = decodeServer(JSON.stringify({ t: 'state' }));
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('state');
  });

  it('returns null WITHOUT warning for an unknown message type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = decodeServer(JSON.stringify({ t: 'totallyNotAServerType', x: 1 }));
    expect(out).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns null WITHOUT warning for non-JSON input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = decodeServer('not json{');
    expect(out).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('decodes a valid server frame without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = decodeServer(JSON.stringify({ t: 'error', message: 'boom' }));
    expect(out).toEqual({ t: 'error', message: 'boom' });
    expect(warn).not.toHaveBeenCalled();
  });
});
