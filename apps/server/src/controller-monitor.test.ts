import { describe, expect, it } from 'vitest';
import { defaultProject, parseProject, controllerSchema, type Controller, type OutputSettings } from '@ledrums/core';
import { FakePixliteClient, makeFakeProber, type ControllerIdentity } from '@ledrums/io';
import {
  candidateSubnets,
  createControllerMonitor,
  subnet24,
  type IntervalScheduler,
} from './controller-monitor';
import type { ControllerStatus, ServerMessage } from './ws-protocol';

const CONTROLLER_HOST = '192.168.9.77';
const OUTPUT_HOST = '192.168.9.50'; // same /24 as the controller, so discovery sweeps toward it

function outputSettings(over: Partial<OutputSettings> = {}): OutputSettings {
  return { state: 'armed', protocol: 'sacn', host: OUTPUT_HOST, broadcast: false, rgbOrder: 'RGB', fps: 44, priority: 100, ...over };
}

/** A hand-driven interval scheduler: tests call `tick()` to fire the poll callback, `active`
 * reflects whether the loop is armed (proves the "no idle traffic" gate). */
function fakeScheduler() {
  let fn: (() => void) | null = null;
  const scheduler: IntervalScheduler = {
    set(f) {
      fn = f;
      return {};
    },
    clear() {
      fn = null;
    },
  };
  return { scheduler, tick: () => fn?.(), get active(): boolean { return fn !== null; } };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface HarnessOptions {
  initialController?: Controller;
  createClient?: (opts: { host: string; auth?: string }) => FakePixliteClient;
}

function makeHarness(opts: HarnessOptions = {}) {
  const messages: ServerMessage[] = [];
  const fake = new FakePixliteClient({ host: CONTROLLER_HOST });
  const identity = fake.identity as ControllerIdentity;
  const persisted: { controller: Controller | undefined } = { controller: opts.initialController };
  const createClientCalls: Array<{ host: string; auth?: string }> = [];
  let now = 1000;
  const sched = fakeScheduler();

  const monitor = createControllerMonitor({
    createClient: (o) => {
      createClientCalls.push(o);
      return (opts.createClient ?? (() => fake))(o);
    },
    probe: makeFakeProber({ [CONTROLLER_HOST]: identity }),
    getOutputSettings: () => outputSettings(),
    getController: () => persisted.controller,
    persistController: (c) => {
      persisted.controller = c ?? undefined;
    },
    broadcast: (m) => messages.push(m),
    localSubnets: () => [],
    now: () => now,
    scheduler: sched.scheduler,
    sweepTimeoutMs: 20,
    pollMs: 1000,
  });

  return {
    monitor,
    messages,
    fake,
    identity,
    persisted,
    createClientCalls,
    sched,
    setNow: (v: number) => {
      now = v;
    },
    lastStatus(): ControllerStatus | null {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        if (m.t === 'controllerStatus') return m.status;
      }
      return null;
    },
  };
}

describe('subnet derivation', () => {
  it('maps a unicast IPv4 to its /24 and rejects broadcast/multicast/zero', () => {
    expect(subnet24('192.168.0.50')).toBe('192.168.0.0/24');
    expect(subnet24('10.1.2.3')).toBe('10.1.2.0/24');
    expect(subnet24('255.255.255.255')).toBeNull();
    expect(subnet24('224.0.0.1')).toBeNull();
    expect(subnet24('0.0.0.0')).toBeNull();
    expect(subnet24('not-an-ip')).toBeNull();
  });

  it('derives the candidate subnet from the output host, falling back to local NICs', () => {
    expect(candidateSubnets(outputSettings(), () => [])).toEqual(['192.168.9.0/24']);
    // Broadcast host yields no /24 → falls back to injected local subnets.
    expect(candidateSubnets(outputSettings({ host: '255.255.255.255' }), () => ['10.0.0.0/24'])).toEqual(['10.0.0.0/24']);
  });
});

describe('controller monitor', () => {
  it('discovers → adopts → emits controllerStatus with the correct shape', async () => {
    const h = makeHarness();

    const candidates = await h.monitor.discover();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      host: CONTROLLER_HOST,
      prodName: 'PixLite A16-S Mk3',
      nickname: 'Roof Left 1',
      fwVer: '1.2.3',
      authReqd: false,
    });
    const discoveryMsg = h.messages.find((m) => m.t === 'controllerDiscovery');
    expect(discoveryMsg).toBeTruthy();

    const result = await h.monitor.adopt(CONTROLLER_HOST);
    expect(result.ok).toBe(true);

    // Watch (client opened the panel) then poll — the status carries identity + rx + rates + health.
    h.monitor.watch({});
    await h.monitor.pollOnce();

    const status = h.lastStatus()!;
    expect(status.host).toBe(CONTROLLER_HOST);
    expect(status.reachable).toBe(true);
    expect(status.identity).toMatchObject({ host: CONTROLLER_HOST, prodName: 'PixLite A16-S Mk3', nickname: 'Roof Left 1', fwVer: '1.2.3', authReqd: false });
    // Default fake stats: 3 sACN universes, all receiving (timedOut === false).
    expect(status.universes).toHaveLength(3);
    expect(status.universes.every((u) => u.protocol === 'sACN' && u.receiving)).toBe(true);
    expect(status.universes[0]).toMatchObject({ uniNum: 10, receiving: true, inGood: 1000, inBadSeq: 0, priority: 100 });
    expect(status.rates).toEqual({ inFrmRate: 45, outFrmRate: 45 });
    expect(status.health).toMatchObject({ tempC: 32.5, portStatus: ['Good'] });
    expect(status.lastSeen).toBe(1000);
  });

  it('reports a universe that is NOT receiving as receiving:false', async () => {
    const h = makeHarness();
    h.fake.stats = {
      universes: {
        sACN: [{ uniNum: 10, timedOut: true, inGood: 0, inBadSeq: 0 }],
        artNet: [{ uniNum: 20, timedOut: false, inGood: 5, inBadSeq: 1 }],
      },
      rates: {},
      health: {},
      raw: {},
    };
    await h.monitor.adopt(CONTROLLER_HOST);
    h.monitor.watch({});
    await h.monitor.pollOnce();

    const status = h.lastStatus()!;
    expect(status.universes).toEqual([
      { uniNum: 10, protocol: 'sACN', receiving: false, inGood: 0, inBadSeq: 0 },
      { uniNum: 20, protocol: 'artNet', receiving: true, inGood: 5, inBadSeq: 1 },
    ]);
  });

  it('ages lastSeen (freezes it, reachable:false) when the controller goes quiet', async () => {
    const h = makeHarness();
    await h.monitor.adopt(CONTROLLER_HOST);
    h.monitor.watch({});

    h.setNow(2000);
    await h.monitor.pollOnce();
    expect(h.lastStatus()).toMatchObject({ reachable: true, lastSeen: 2000 });

    // Controller goes quiet: the next poll errors. lastSeen must NOT advance — it ages.
    h.setNow(9000);
    h.fake.failNext = new Error('ETIMEDOUT');
    await h.monitor.pollOnce();

    const status = h.lastStatus()!;
    expect(status.reachable).toBe(false);
    expect(status.lastSeen).toBe(2000); // frozen at the last successful contact
  });

  it('persists the adopted controller and rehydrates it with the Project', async () => {
    const h = makeHarness();
    await h.monitor.adopt(CONTROLLER_HOST);

    // Adoption persisted { host, nickname } (data-only, no auth for an unauthenticated device).
    expect(h.persisted.controller).toEqual({ host: CONTROLLER_HOST, nickname: 'Roof Left 1' });

    // The persisted shape round-trips through the core Project schema (rehydrates across restarts).
    const persisted = h.persisted.controller!;
    const project = parseProject({ ...defaultProject(), controller: persisted });
    expect(project.controller).toEqual(persisted);
    expect(parseProject(defaultProject()).controller).toBeUndefined();
    expect(controllerSchema.parse({ host: '1.2.3.4', nickname: 'x', auth: 'HASH' })).toEqual({ host: '1.2.3.4', nickname: 'x', auth: 'HASH' });

    // A fresh monitor booted from that persisted controller adopts it on hydrate.
    const h2 = makeHarness({ initialController: persisted });
    h2.monitor.hydrate();
    expect(h2.createClientCalls).toEqual([{ host: CONTROLLER_HOST, auth: undefined }]);
    h2.monitor.watch({});
    await h2.monitor.pollOnce();
    expect(h2.lastStatus()?.host).toBe(CONTROLLER_HOST);
  });

  it('polls ONLY while a client is watching — no idle traffic', async () => {
    const h = makeHarness();
    await h.monitor.adopt(CONTROLLER_HOST); // adopt uses probe(), never the polling client
    expect(h.fake.calls).toEqual([]); // nothing read from the controller yet
    expect(h.monitor.isPolling()).toBe(false);
    expect(h.sched.active).toBe(false);

    // Ticking a non-armed loop does nothing (defensive — there is no interval registered).
    h.sched.tick();
    await flush();
    expect(h.fake.calls).toEqual([]);

    // A client opens the panel → the loop arms and polls (immediate poll on start).
    const key = {};
    h.monitor.watch(key);
    expect(h.monitor.isPolling()).toBe(true);
    expect(h.sched.active).toBe(true);
    await flush();
    expect(h.fake.calls).toContain('statisticRead');

    // Interval ticks keep polling while watched.
    const before = h.fake.calls.length;
    h.sched.tick();
    await flush();
    expect(h.fake.calls.length).toBeGreaterThan(before);

    // The client closes the panel → the loop disarms; further ticks are impossible (no interval).
    h.monitor.dropWatcher(key);
    expect(h.monitor.isPolling()).toBe(false);
    expect(h.sched.active).toBe(false);
    const afterDrop = h.fake.calls.length;
    h.sched.tick();
    await flush();
    expect(h.fake.calls.length).toBe(afterDrop);
  });

  it('multiple watchers keep polling until the LAST one leaves', async () => {
    const h = makeHarness();
    await h.monitor.adopt(CONTROLLER_HOST);
    const a = {};
    const b = {};
    h.monitor.watch(a);
    h.monitor.watch(b);
    expect(h.monitor.isPolling()).toBe(true);
    h.monitor.dropWatcher(a);
    expect(h.monitor.isPolling()).toBe(true); // b still watching
    h.monitor.dropWatcher(b);
    expect(h.monitor.isPolling()).toBe(false);
  });

  it('refuses to adopt a host that does not answer as a PixLite', async () => {
    const h = makeHarness();
    const result = await h.monitor.adopt('192.168.9.200'); // not in the prober map
    expect(result.ok).toBe(false);
    expect(result.error).toContain('192.168.9.200');
    expect(h.persisted.controller).toBeUndefined();
    expect(h.monitor.isPolling()).toBe(false);
  });

  it('identify forwards the duration to the adopted controller', async () => {
    const h = makeHarness();
    await h.monitor.adopt(CONTROLLER_HOST);
    await h.monitor.identify(5);
    expect(h.fake.identifyCalls).toEqual([5]);
  });
});
