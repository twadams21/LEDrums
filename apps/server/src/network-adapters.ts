/**
 * Network-adapter enumeration + controller-IP recommendation (the "different IP addresses" fix).
 *
 * The PixLite is discovered by a UNICAST subnet sweep (`@ledrums/io` `sweep`), so the controller and
 * the PC must share an IP subnet or the box is never seen. This module answers the operator's real
 * question — "what should I set the controller to?" — by enumerating the server machine's own NICs
 * and, for each, computing a concrete static IP in that adapter's subnet. The web is a pure renderer
 * of the result (it does no IP math), so the recommendation lives here where it is unit-tested.
 *
 * Pure except for {@link listNetworkAdapters}, whose only impurity (the OS NIC table) is injected so
 * it stays testable without real hardware. `packages/core` never touches any of this.
 */
import { networkInterfaces } from 'node:os';
import type { NetworkAdapter } from './ws-protocol';

/** The subset of `os.NetworkInterfaceInfo` this module reads — declared locally so the injectable
 * enumerator in tests needn't construct full Node objects. */
export interface NicInfo {
  family: string | number;
  internal: boolean;
  address: string;
  netmask: string;
  cidr?: string | null;
}

/** The shape of `os.networkInterfaces()` — a dict of adapter name → its addresses. */
export type NicEnumerator = () => Record<string, NicInfo[] | undefined>;

// ── Pure IPv4 helpers ────────────────────────────────────────────────────────

/** Parse dotted-decimal IPv4 to an unsigned 32-bit int. Throws on malformed input. */
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

/** Count the set bits of a dotted-decimal mask → CIDR prefix length (e.g. 255.255.255.0 → 24). */
function prefixFromMask(netmask: string): number {
  let bits = 0;
  for (let i = 0; i < 4; i++) {
    const octet = (ipToInt(netmask) >>> (24 - i * 8)) & 0xff;
    bits += (octet.toString(2).match(/1/g) ?? []).length;
  }
  return bits;
}

/**
 * Recommend a static IP for the controller in the adapter's subnet: in-range, NOT the PC's own
 * address, and avoiding the network / broadcast / `.1` gateway addresses. Prefers a memorable high
 * host (`.50`, `.100`, …) and falls back to the first usable host if the subnet is small. On a
 * subnet with no room for a second host (/31, /32) it returns the PC's address unchanged (degenerate
 * — the caller has nothing better to offer). Pure.
 */
export function recommendControllerIp(address: string, netmask: string): string {
  const addr = ipToInt(address);
  const mask = ipToInt(netmask);
  const network = (addr & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const firstHost = (network + 1) >>> 0;
  const lastHost = (broadcast - 1) >>> 0;
  if (lastHost < firstHost) return address; // /31 or /32 — no second host to suggest

  const gateway = (network + 1) >>> 0; // the conventional .1 — avoid recommending it
  const usable = (n: number): boolean => n >= firstHost && n <= lastHost && n !== addr;
  // Memorable offsets first (so a typical /24 gets .50, .100, …); every offset is ≥ 2, so none of
  // these collide with the .1 gateway.
  for (const off of [50, 100, 150, 200, 60, 40, 51, 20, 2]) {
    if (usable((network + off) >>> 0)) return intToIp((network + off) >>> 0);
  }
  // Fallback (small subnet): the first usable host that isn't the PC, skipping .1 unless it's the
  // only address left.
  for (let n = firstHost; n <= lastHost; n++) {
    if (usable(n) && (n !== gateway || firstHost === lastHost)) return intToIp(n);
  }
  return address;
}

/** Build the {@link NetworkAdapter} view of one NIC entry (address + mask + derived subnet/rec). */
function toAdapter(name: string, nic: NicInfo): NetworkAdapter {
  const prefix = nic.cidr ? Number(nic.cidr.split('/')[1]) : prefixFromMask(nic.netmask);
  const network = (ipToInt(nic.address) & ipToInt(nic.netmask)) >>> 0;
  return {
    name,
    address: nic.address,
    netmask: nic.netmask,
    cidr: nic.cidr ?? `${nic.address}/${prefix}`,
    subnet: `${intToIp(network)}/${prefix}`,
    recommendedIp: recommendControllerIp(nic.address, nic.netmask),
  };
}

/** Node reports IPv4 family as the string `'IPv4'` (modern) or the number `4` (legacy) — accept both. */
function isIPv4(family: string | number): boolean {
  return family === 'IPv4' || family === 4;
}

/**
 * Enumerate the server machine's usable network adapters — non-internal IPv4 NICs with an address —
 * each carrying its subnet and a recommended controller IP. Malformed entries are skipped rather
 * than throwing so one odd NIC can't blank the whole list. The OS table is injected for tests.
 */
export function listNetworkAdapters(enumerate: NicEnumerator = networkInterfaces): NetworkAdapter[] {
  const out: NetworkAdapter[] = [];
  for (const [name, addrs] of Object.entries(enumerate())) {
    for (const nic of addrs ?? []) {
      if (!isIPv4(nic.family) || nic.internal || !nic.address || !nic.netmask) continue;
      try {
        out.push(toAdapter(name, nic));
      } catch {
        /* skip a NIC whose address/mask won't parse */
      }
    }
  }
  return out;
}
