/**
 * Subnet-sweep discovery. There is NO broadcast/mDNS discovery in the PixLite
 * API — "find it on the network" means probing each host of a subnet with a
 * short-timeout `GET /ver`. This module is pure: it takes the prober as a
 * dependency, so discovery is fully testable without a network.
 */
import type { ControllerIdentity } from './types';

/** The dependency sweep needs: identity for a host, or null if none responds. */
export type Prober = (host: string, timeoutMs: number) => Promise<ControllerIdentity | null>;

export interface RankedCandidate {
  host: string;
  identity: ControllerIdentity;
  /** Higher = more likely the controller you want. */
  score: number;
}

export interface SweepOptions {
  /** Per-probe timeout. Default 400ms — sweeps must be quick. */
  timeoutMs?: number;
  /** Max concurrent probes (across distinct hosts). Default 32. */
  concurrency?: number;
}

const MAX_SWEEP_HOSTS = 1024;

function ipToInt(addr: string): number {
  const parts = addr.split('.');
  if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${addr}`);
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) throw new Error(`invalid IPv4 address: ${addr}`);
    n = (n * 256 + o) >>> 0;
  }
  return n >>> 0;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

/** Expand an IPv4 CIDR (e.g. `192.168.1.0/24`) into its usable host addresses. */
export function expandCidr(cidr: string): string[] {
  const slash = cidr.indexOf('/');
  if (slash < 0) throw new Error(`not a CIDR: ${cidr}`);
  const addr = cidr.slice(0, slash);
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid CIDR prefix: ${cidr}`);
  }
  const base = ipToInt(addr);
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  if (size > MAX_SWEEP_HOSTS) {
    throw new Error(`CIDR ${cidr} spans ${size} addresses (max ${MAX_SWEEP_HOSTS} to sweep)`);
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << hostBits) >>> 0;
  const network = (base & mask) >>> 0;
  const hosts: string[] = [];
  for (let i = 0; i < size; i++) {
    // For /30 and larger blocks, skip the network & broadcast addresses.
    if (hostBits >= 2 && (i === 0 || i === size - 1)) continue;
    hosts.push(intToIp((network + i) >>> 0));
  }
  return hosts;
}

/** Normalize a CIDR / single address / list thereof into a flat, deduped host list. */
export function expandTargets(cidrOrAddrs: string | string[]): string[] {
  const list = Array.isArray(cidrOrAddrs) ? cidrOrAddrs : [cidrOrAddrs];
  const hosts = list.flatMap((t) => (t.includes('/') ? expandCidr(t) : [t]));
  return [...new Set(hosts)];
}

/** Rank a responder: Advatek/PixLite-branded controllers sort above generic responders. */
function scoreIdentity(id: ControllerIdentity): number {
  return /pixlite|advatek/i.test(id.prodName) ? 2 : 1;
}

/**
 * Probe every target and return the responders, best-first. Takes the prober as
 * a dependency (inject {@link probe} in production, a canned fn in tests).
 * Concurrency is bounded; the sequential-request rule is per-controller and does
 * not apply across distinct hosts.
 */
export async function sweep(
  cidrOrAddrs: string | string[],
  prober: Prober,
  opts: SweepOptions = {},
): Promise<RankedCandidate[]> {
  const timeoutMs = opts.timeoutMs ?? 400;
  const concurrency = Math.max(1, opts.concurrency ?? 32);
  const hosts = expandTargets(cidrOrAddrs);

  const found: RankedCandidate[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= hosts.length) return;
      const host = hosts[i]!;
      const identity = await prober(host, timeoutMs);
      if (identity) found.push({ host, identity, score: scoreIdentity(identity) });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));

  // Stable rank: score desc, ties broken by original host order.
  const order = new Map(hosts.map((h, i) => [h, i]));
  return found.sort((a, b) => b.score - a.score || order.get(a.host)! - order.get(b.host)!);
}
