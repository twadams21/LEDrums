import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeServer } from './protocol-types';
import { deserializeShowLibrary } from '../trigger-lab/persistence';

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

  it.each(['__proto__', 'constructor', 'toString'])('decodes a viewer library with hostile graph key %s', (graphKey) => {
    const graph = { nodes: [{ id: 'trigger', kind: 'trigger' }], edges: [] };
    const decoded = decodeServer(JSON.stringify({
      t: 'showLibrary',
      library: {
        version: 2,
        data: {
          activeShowId: 'show',
          shows: {
            show: {
              id: 'show',
              name: 'Show',
              authored: { graphs: Object.fromEntries([[graphKey, graph]]), songs: [], effects: [], presets: [], buses: [] },
            },
          },
        },
      },
    }));
    expect(decoded?.t).toBe('showLibrary');
    if (decoded?.t !== 'showLibrary') return;
    const library = deserializeShowLibrary(decoded.library);
    expect(library).not.toBeNull();
    expect(Object.hasOwn(library!.shows.show!.authored.graphs, graphKey)).toBe(true);
  });
});
