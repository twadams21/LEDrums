import { describe, expect, it } from 'vitest';
import { defaultIdentity, FakePixliteClient } from './fake';

describe('FakePixliteClient', () => {
  it('covers every client method with canned data and records calls', async () => {
    const c = new FakePixliteClient();
    const id = await c.probe();
    expect(id?.prodName).toBe('PixLite A16-S Mk3');

    const stats = await c.statisticRead(['']);
    expect(stats.universes.sACN).toHaveLength(3);
    expect(stats.universes.sACN[0]?.timedOut).toBe(false);

    await c.identify(120);
    await c.modeTestData({ op: 'setColor', color: [255, 0, 0, 0] });

    expect(c.identifyCalls).toEqual([120]);
    expect(c.testDataCalls).toEqual([{ op: 'setColor', color: [255, 0, 0, 0] }]);
    expect(c.calls).toEqual(['probe', 'statisticRead', 'identify', 'modeTestData']);
  });

  it('is fully controllable — identity, stats, and canned failures', async () => {
    const c = new FakePixliteClient({ identity: null });
    expect(await c.probe()).toBeNull();

    c.identity = defaultIdentity('1.2.3.4');
    expect((await c.probe())?.host).toBe('1.2.3.4');

    c.failNext = new Error('simulated timeout');
    await expect(c.statisticRead([''])).rejects.toThrow(/simulated timeout/);
    // Failure clears after one call.
    await expect(c.statisticRead([''])).resolves.toBeDefined();
  });
});
