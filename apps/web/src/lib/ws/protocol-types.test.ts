import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeServer } from './protocol-types';
import { SHOWS_VERSION_EFFECTS } from '@ledrums/core';
import { deserializeShowLibraryV3 } from '../trigger-lab/persistence';

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

  it.each(['__proto__', 'constructor', 'toString'])('decodes a viewer library with hostile show id %s', (showId) => {
    const decoded = decodeServer(JSON.stringify({
      t: 'showLibrary',
      library: {
        version: SHOWS_VERSION_EFFECTS,
        data: {
          activeShowId: showId,
          shows: Object.fromEntries([[showId, { id: showId, name: 'Show', authored: { songs: [] } }]]),
        },
      },
    }));
    expect(decoded?.t).toBe('showLibrary');
    if (decoded?.t !== 'showLibrary') return;
    const library = deserializeShowLibraryV3(decoded.library);
    expect(library).not.toBeNull();
    expect(Object.hasOwn(library!.shows, showId)).toBe(true);
    expect(library!.activeShowId).toBe(showId);
  });
});
