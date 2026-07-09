/**
 * Controller-monitor service (S47, group L) — the server-side owner of the adopted PixLite
 * controller. It closes the confidence chain's last link: *the controller actually received the
 * pixels and is outputting them.* Three responsibilities, one deep module:
 *
 *  1. **Discover** — sweep the candidate subnet(s) derived from the configured output host/iface
 *     (falling back to local NIC subnets) with S46's `sweep` + `probe`, and report the ranked
 *     candidates back to the panel.
 *  2. **Adopt** — probe a chosen host, persist `{ host, nickname }` on the Project (rehydrated
 *     across restarts), and hold ONE {@link PixliteClient} for it (its internal queue enforces the
 *     API's sequential-request rule).
 *  3. **Poll** — read `statisticRead` at 1–2s and emit `controllerStatus`, but ONLY while ≥1 client
 *     is watching the panel AND a controller is adopted. No watchers ⇒ no traffic (the loop is
 *     literally not armed). A failed poll ages `lastSeen` (freezes it) and flips `reachable` false.
 *
 * Everything network/IO lives in `@ledrums/io` behind the injected `createClient`/`probe`; this
 * module is pure orchestration and is unit-tested with the S46 fake (no sockets). `packages/core`
 * never touches any of it — the monitor only reads the data-only `project.controller` field.
 */
import { networkInterfaces } from 'node:os';
import type { Controller, OutputSettings } from '@ledrums/core';
import { authHash, sweep } from '@ledrums/io';
import type {
  ControllerIdentity,
  ControllerStats,
  PixliteClient,
  UniverseRx,
} from '@ledrums/io';
import type {
  ControllerStatus,
  ControllerTestPattern,
  ControllerUniverseRx,
  DiscoveredController,
  ServerMessage,
} from './ws-protocol';
import type { MonitorDraft } from './monitor';

/** Minimal interval abstraction so tests drive polls deterministically (no real timers). */
export interface IntervalScheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Real timers, unref'd so the poll loop never keeps the process alive on shutdown. */
const defaultScheduler: IntervalScheduler = {
  set(fn, ms) {
    const handle = setInterval(fn, ms);
    // Node's Timeout has unref; guard for non-Node just in case.
    if (handle && typeof (handle as { unref?: unknown }).unref === 'function') {
      (handle as { unref: () => void }).unref();
    }
    return handle;
  },
  clear(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

export interface ControllerMonitorDeps {
  /** Build the per-controller client (real {@link HttpPixliteClient} in prod, fake in tests). ONE
   * instance per controller — its internal queue enforces the sequential-request rule. `auth` is
   * the persisted HASH (never plaintext). */
  createClient: (opts: { host: string; auth?: string }) => PixliteClient;
  /** Probe a single host's identity (unauthenticated `/ver`). Injected so discovery is testable. */
  probe: (host: string, timeoutMs: number) => Promise<ControllerIdentity | null>;
  /** Current output settings — the candidate subnet is derived from `host`/`iface`. */
  getOutputSettings: () => OutputSettings;
  /** The adopted controller persisted on the Project, or undefined. Read on {@link hydrate}. */
  getController: () => Controller | undefined;
  /** Persist the adopted controller (or null to clear) onto the Project + trigger autosave. */
  persistController: (controller: Controller | null) => void;
  /** Broadcast a server message to all clients (`controllerStatus` / `controllerDiscovery`). */
  broadcast: (msg: ServerMessage) => void;
  /** Append a Monitor event (optional). */
  monitor?: (event: MonitorDraft) => void;
  /** Local NIC /24 subnets to sweep when the output host yields none. Injected for testability. */
  localSubnets?: () => string[];
  /** Poll cadence in ms (1–2s range). Default 1500. */
  pollMs?: number;
  /** Per-probe sweep timeout in ms. Default 400. */
  sweepTimeoutMs?: number;
  /** Clock — injectable for deterministic `lastSeen` tests. Default {@link Date.now}. */
  now?: () => number;
  /** Interval scheduler — injectable so tests tick polls by hand. Default real (unref'd) timers. */
  scheduler?: IntervalScheduler;
}

/** Result of an {@link ControllerMonitor.adopt} — `ok` false carries a user-facing reason. */
export interface AdoptResult {
  ok: boolean;
  error?: string;
}

/** Local NIC /24 subnets (non-internal IPv4), the discovery fallback when the output host is
 * broadcast/multicast/unset. Exported for direct testing. */
export function localNicSubnets(): string[] {
  const out = new Set<string>();
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        const s = subnet24(a.address);
        if (s) out.add(s);
      }
    }
  }
  return [...out];
}

/** The /24 network CIDR containing a UNICAST IPv4 address, or null for a broadcast/multicast/zero/
 * non-IPv4 input (those can't seed a sweep). e.g. `192.168.0.50` → `192.168.0.0/24`. */
export function subnet24(ip: string): string | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const oct = m.slice(1, 5).map(Number);
  if (oct.some((o) => o > 255)) return null;
  const [a, b, c] = oct as [number, number, number, number];
  // Skip 0.x (this-network), 255.x, and 224+ (multicast/reserved) — never a controller's unicast /24.
  if (a === 0 || a === 255 || a >= 224) return null;
  return `${a}.${b}.${c}.0/24`;
}

/** Candidate subnets for a discovery sweep: the output host's /24 (and iface's, if it's an IP),
 * falling back to local NIC subnets when neither yields a unicast /24. Deduped. */
export function candidateSubnets(settings: OutputSettings, localSubnets: () => string[]): string[] {
  const out = new Set<string>();
  const host = subnet24(settings.host);
  if (host) out.add(host);
  if (settings.iface) {
    const iface = subnet24(settings.iface);
    if (iface) out.add(iface);
  }
  if (out.size === 0) for (const s of localSubnets()) out.add(s);
  return [...out];
}

/** Flatten the controller's parallel sACN/Art-Net rx arrays into the panel's row list.
 * `receiving = !timedOut` (the io contract: `timedOut === false` means the universe IS receiving). */
function mapUniverses(stats: ControllerStats): ControllerUniverseRx[] {
  const one = (u: UniverseRx, protocol: 'sACN' | 'artNet'): ControllerUniverseRx => ({
    uniNum: u.uniNum,
    protocol,
    receiving: u.timedOut === false,
    inGood: u.inGood,
    inBadSeq: u.inBadSeq,
    ...(u.inLowPri !== undefined ? { inLowPri: u.inLowPri } : {}),
    ...(u.priority !== undefined ? { priority: u.priority } : {}),
    ...(u.sourceName !== undefined ? { sourceName: u.sourceName } : {}),
  });
  return [
    ...stats.universes.sACN.map((u) => one(u, 'sACN')),
    ...stats.universes.artNet.map((u) => one(u, 'artNet')),
  ];
}

function toDiscovered(host: string, id: ControllerIdentity, score: number): DiscoveredController {
  return { host, prodName: id.prodName, nickname: id.nickname, fwVer: id.fwVer, authReqd: id.authReqd, score };
}

/**
 * Create the controller-monitor service. The returned object is driven by the WS message handler
 * (`discover`/`adopt`/`identify`/`watch`) and the connection lifecycle (`watch`/`dropWatcher` on a
 * client's Monitor/Patch panel open/close and on disconnect). `hydrate` is called at boot to adopt
 * a controller already persisted on the Project.
 */
export function createControllerMonitor(deps: ControllerMonitorDeps) {
  const now = deps.now ?? Date.now;
  const scheduler = deps.scheduler ?? defaultScheduler;
  const pollMs = deps.pollMs ?? 1500;
  const sweepTimeoutMs = deps.sweepTimeoutMs ?? 400;
  const localSubnets = deps.localSubnets ?? localNicSubnets;

  // Adopted-controller state.
  let client: PixliteClient | null = null;
  let host: string | null = null;
  let nickname = '';
  let auth: string | undefined;
  let identity: ControllerIdentity | null = null;
  let universes: ControllerUniverseRx[] = [];
  let rates: ControllerStatus['rates'] = {};
  let health: ControllerStatus['health'] = {};
  let lastSeen: number | null = null;
  let reachable = false;
  let statsEverSucceeded = false;
  // Active built-in test pattern (S49), or null in normal LIVE mode. Server-authoritative so every
  // watcher's takeover banner + output pill agree. While non-null the box ignores the Art-Net stream.
  let testPattern: ControllerTestPattern | null = null;

  // Interest tracking — the ONLY gate on the poll loop. Keyed by an opaque token (the ws socket).
  const watchers = new Set<object>();
  let timer: unknown = null;
  let pollInFlight = false;

  function currentStatus(): ControllerStatus | null {
    if (!host) return null;
    return { host, reachable, identity, universes, rates, health, lastSeen, testPattern };
  }

  function emitStatus(): void {
    deps.broadcast({ t: 'controllerStatus', status: currentStatus() });
  }

  function shouldPoll(): boolean {
    return client !== null && watchers.size > 0;
  }

  function startPolling(): void {
    if (timer !== null || !shouldPoll()) return;
    timer = scheduler.set(() => void pollOnce(), pollMs);
    // Kick an immediate poll so a freshly-opened panel doesn't wait a whole interval for data.
    void pollOnce();
  }

  function stopPolling(): void {
    if (timer === null) return;
    scheduler.clear(timer);
    timer = null;
  }

  /** True while the poll loop is armed — tests assert this to prove "no idle traffic". */
  function isPolling(): boolean {
    return timer !== null;
  }

  /** Return the controller to LIVE mode and clear the takeover state. No-op unless a client is held
   * AND a test pattern is active — so the auto-revert on the last watcher leaving is free when no
   * pattern runs, and an explicit back-to-live is idempotent. `reason` tags the Monitor event so
   * an auto-revert (nobody watching) reads differently from an operator's click. */
  async function revertToLive(reason: 'client' | 'auto'): Promise<void> {
    if (!client || !testPattern) return;
    testPattern = null;
    emitStatus();
    try {
      await client.modeLive();
      deps.monitor?.({
        type: 'output',
        direction: 'out',
        source: 'server/controller',
        destination: host ?? 'controller',
        label: reason === 'auto' ? 'Controller back to live (auto)' : 'Controller back to live',
        detail: reason === 'auto' ? 'no watchers' : undefined,
      });
    } catch (err) {
      deps.monitor?.({
        type: 'error',
        direction: 'out',
        source: 'server/controller',
        destination: host ?? 'controller',
        label: 'Controller back-to-live failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function pollOnce(): Promise<void> {
    if (!client || pollInFlight) return;
    pollInFlight = true;
    try {
      // Identity comes from `/ver`, not statisticRead — fetch it lazily on the first poll after a
      // hydrate (adopt already has it). A null probe here means unreachable → handled by the catch.
      if (!identity) {
        const id = await client.probe();
        if (id) identity = id;
      }
      const stats = await client.statisticRead(['']);
      universes = mapUniverses(stats);
      rates = { ...stats.rates };
      health = { ...stats.health };
      lastSeen = now();
      reachable = true;
      statsEverSucceeded = true;
      emitStatus();
    } catch (err) {
      // Any error/timeout ⇒ the controller is unreachable/lost. Freeze `lastSeen` (it ages) and
      // report the lost state so the panel can make it unmissable.
      reachable = !statsEverSucceeded && identity !== null && lastSeen !== null;
      emitStatus();
      deps.monitor?.({
        type: reachable ? 'system' : 'error',
        direction: 'in',
        source: 'server/controller',
        destination: host ?? 'controller',
        label: reachable ? 'Controller stats unavailable' : 'Controller poll failed (unreachable)',
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      pollInFlight = false;
    }
  }

  return {
    /** Adopt a controller already persisted on the Project (boot recovery). Emits an initial
     * `controllerStatus` (identity/stats fill in on the first poll once a client watches). */
    hydrate(): void {
      const c = deps.getController();
      if (!c) return;
      client = deps.createClient({ host: c.host, auth: c.auth });
      host = c.host;
      nickname = c.nickname;
      auth = c.auth;
      identity = null;
      universes = [];
      rates = {};
      health = {};
      lastSeen = null;
      reachable = false;
      statsEverSucceeded = false;
      testPattern = null;
      startPolling();
    },

    /** One-shot discovery sweep. Broadcasts a `controllerDiscovery` with the ranked candidates
     * (empty = swept, none found). */
    async discover(): Promise<DiscoveredController[]> {
      const subnets = candidateSubnets(deps.getOutputSettings(), localSubnets);
      const found: DiscoveredController[] = [];
      // Sweep each subnet with S46's ranked sweep (unqueued — the sequential rule is per-controller).
      for (const subnet of subnets) {
        try {
          const ranked = await sweep(subnet, deps.probe, { timeoutMs: sweepTimeoutMs });
          for (const c of ranked) found.push(toDiscovered(c.host, c.identity, c.score));
        } catch (err) {
          deps.monitor?.({
            type: 'error',
            direction: 'local',
            source: 'server/controller',
            destination: subnet,
            label: 'Discovery sweep failed',
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // Best-first across subnets; dedupe by host (first/highest wins).
      const byHost = new Map<string, DiscoveredController>();
      for (const c of found.sort((a, b) => b.score - a.score)) {
        if (!byHost.has(c.host)) byHost.set(c.host, c);
      }
      const candidates = [...byHost.values()];
      deps.monitor?.({
        type: 'system',
        direction: 'local',
        source: 'server/controller',
        destination: 'discovery',
        label: `Controller discovery: ${candidates.length} found`,
        detail: subnets.join(', ') || 'no candidate subnets',
      });
      deps.broadcast({ t: 'controllerDiscovery', candidates });
      return candidates;
    },

    /** Adopt `targetHost`: probe it, persist `{ host, nickname }` on the Project, hold one client,
     * and begin reporting its status. A non-PixLite host is refused (no adoption). */
    async adopt(targetHost: string): Promise<AdoptResult> {
      const id = await deps.probe(targetHost, sweepTimeoutMs);
      if (!id) {
        deps.monitor?.({
          type: 'error',
          direction: 'in',
          source: 'client',
          destination: targetHost,
          label: 'Controller adoption failed (no response)',
        });
        return { ok: false, error: `No PixLite controller answered at ${targetHost}.` };
      }
      host = targetHost;
      nickname = id.nickname;
      auth = deps.getController()?.host === targetHost ? deps.getController()?.auth : undefined;
      identity = id;
      universes = [];
      rates = {};
      health = {};
      lastSeen = now();
      reachable = true;
      statsEverSucceeded = false;
      testPattern = null;
      client = deps.createClient({ host, auth });
      deps.persistController({ host, nickname, ...(auth ? { auth } : {}) });
      deps.monitor?.({
        type: 'system',
        direction: 'in',
        source: 'client',
        destination: host,
        label: 'Controller adopted',
        detail: `${id.prodName}${nickname ? ` · ${nickname}` : ''}`,
      });
      emitStatus();
      // If clients are already watching, begin polling now (else it starts on the next watch).
      startPolling();
      return { ok: true };
    },

    /** Set (or clear) the adopted controller's admin password (R29 / GH #108). Hashes the PLAINTEXT
     * to `Base64URL(SHA256(password))` and persists ONLY the hash on the Project (never the
     * plaintext); an empty string clears auth back to the password-less default. Rebuilds the client
     * with the new credential so every subsequent management call authenticates, forgets the prior
     * identity/success so a wrong password shows as unreachable on the next poll, and kicks an
     * immediate poll for instant success/failure feedback. No-op when nothing is adopted. */
    setAuth(password: string): void {
      if (!host) return;
      auth = password ? authHash(password) : undefined;
      identity = null; // re-probe `/ver` so `authReqd` refreshes
      statsEverSucceeded = false; // a stale success must not mask a wrong-password failure
      client = deps.createClient({ host, auth });
      deps.persistController({ host, nickname, ...(auth ? { auth } : {}) });
      deps.monitor?.({
        type: 'system',
        direction: 'local',
        source: 'client',
        destination: host,
        label: auth ? 'Controller password set' : 'Controller password cleared',
      });
      emitStatus();
      // Immediate poll (only does work when a client is watching) so auth success is visible at once.
      void pollOnce();
    },

    /** Flash the adopted controller's status LED for `durationS` seconds. No-op when unadopted. */
    async identify(durationS: number): Promise<void> {
      if (!client) return;
      try {
        await client.identify(durationS);
        deps.monitor?.({
          type: 'output',
          direction: 'out',
          source: 'server/controller',
          destination: host ?? 'controller',
          label: 'Controller identify',
          detail: `${durationS}s`,
        });
      } catch (err) {
        deps.monitor?.({
          type: 'error',
          direction: 'out',
          source: 'server/controller',
          destination: host ?? 'controller',
          label: 'Controller identify failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },

    /** Drive the controller's built-in test-data mode (S49). Sends `modeTestData`, records the
     * active pattern (server-authoritative takeover state), and re-emits status so every watcher's
     * banner + pill light up. No-op when unadopted. On failure the takeover state is NOT set (the
     * box never entered test mode), so the UI can't lie about a takeover that didn't happen. */
    async setTestData(pattern: ControllerTestPattern): Promise<void> {
      if (!client) return;
      try {
        await client.modeTestData(pattern);
        testPattern = pattern;
        emitStatus();
        deps.monitor?.({
          type: 'output',
          direction: 'out',
          source: 'server/controller',
          destination: host ?? 'controller',
          label: 'Controller test pattern',
          detail: pattern.op,
        });
      } catch (err) {
        deps.monitor?.({
          type: 'error',
          direction: 'out',
          source: 'server/controller',
          destination: host ?? 'controller',
          label: 'Controller test pattern failed',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    },

    /** Return the controller to LIVE mode — the "back to live data" exit. Sends `modeLive`, clears
     * the takeover state, and re-emits status. No-op when unadopted or not in a test pattern (so a
     * stray call never spams the device). Also invoked automatically on the last watcher leaving. */
    backToLive(): Promise<void> {
      return revertToLive('client');
    },

    /** A client opened the Monitor/Patch controller panel — register interest (keyed by socket) and
     * start polling if a controller is adopted. Re-broadcasts the current status so the newly-
     * watching client gets last-known state immediately. Idempotent per key. */
    watch(key: object): void {
      watchers.add(key);
      startPolling();
      emitStatus();
    },

    /** A client closed the panel (or disconnected) — drop its interest; stop polling when the last
     * watcher leaves (no idle traffic). When the LAST watcher goes, auto-revert any running test
     * pattern so a controller is never stranded in test mode with nobody watching (S49). Idempotent
     * / safe for an unknown key. */
    dropWatcher(key: object): void {
      if (!watchers.delete(key)) return;
      if (watchers.size === 0) {
        stopPolling();
        void revertToLive('auto');
      }
    },

    /** Force a single poll now (used by tests + could back a manual refresh). */
    pollOnce,
    /** Run a discovery sweep's subnet derivation (test/introspection helper). */
    currentStatus,
    isPolling,
    /** Stop the loop on shutdown. */
    stop: stopPolling,
    /** Live watcher count (introspection/tests). */
    get watcherCount(): number {
      return watchers.size;
    },
  };
}

export type ControllerMonitor = ReturnType<typeof createControllerMonitor>;
