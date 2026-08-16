import { describe, expect, it, vi } from 'vitest';
import { OscLearnController, type OscLearnHost } from './osc-learn.svelte';

/* The arm is a promise: the NEXT address heard binds the field you armed — and nothing else.
   These lock the two ways that promise can break: binding the wrong target now that the union
   has two shapes, and consuming the arm when the bind did not actually happen. */

function host(over: Partial<OscLearnHost> = {}): OscLearnHost & {
  setGlobalControlBinding: ReturnType<typeof vi.fn>;
  setZoneOscAddress: ReturnType<typeof vi.fn>;
} {
  return {
    isViewer: () => false,
    setGlobalControlBinding: vi.fn(() => true),
    setZoneOscAddress: vi.fn(() => true),
    ...over,
  } as never;
}

describe('OscLearnController', () => {
  it('binds an armed ZONE to the heard address, by slot', () => {
    const h = host();
    const c = new OscLearnController(h);
    c.start({ kind: 'zone', drumId: 'kick', slot: 3 });

    c.apply('/sp/kick/beater');

    expect(h.setZoneOscAddress).toHaveBeenCalledWith('kick', 3, '/sp/kick/beater');
    expect(h.setGlobalControlBinding).not.toHaveBeenCalled();
    expect(c.target).toBeNull();
  });

  it('still binds an armed global control — the two targets do not cross', () => {
    const h = host();
    const c = new OscLearnController(h);
    c.start({ kind: 'global-control', action: 'nextSong' });

    c.apply('/next');

    expect(h.setGlobalControlBinding).toHaveBeenCalledWith('nextSong', { oscAddress: '/next' });
    expect(h.setZoneOscAddress).not.toHaveBeenCalled();
  });

  it('stays armed when a zone bind is REFUSED — the gesture was heard, it just could not bind', () => {
    const h = host({ setZoneOscAddress: vi.fn(() => false) as never });
    const c = new OscLearnController(h);
    const target = { kind: 'zone', drumId: 'snare', slot: 1 } as const;
    c.start(target);

    c.apply('/taken');

    expect(c.target).toEqual(target);
  });

  it('ignores an empty address rather than silently eating the arm', () => {
    const h = host();
    const c = new OscLearnController(h);
    c.start({ kind: 'zone', drumId: 'kick', slot: 0 });

    c.apply('   ');

    expect(h.setZoneOscAddress).not.toHaveBeenCalled();
    expect(c.target).not.toBeNull();
  });

  it('never arms or binds for a viewer', () => {
    const h = host({ isViewer: () => true });
    const c = new OscLearnController(h);

    c.start({ kind: 'zone', drumId: 'kick', slot: 0 });

    expect(c.target).toBeNull();
    c.apply('/anything');
    expect(h.setZoneOscAddress).not.toHaveBeenCalled();
  });
});
