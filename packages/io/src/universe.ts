/**
 * Protocol universe domains. Art-Net addresses a 15-bit universe field (0..32767 —
 * see the encoder's LSB/MSB split in artnet.ts). ANSI E1.31 (sACN) universes are
 * 1..63999: universe 0 is spec-invalid, and sacnMulticastAddress(0) yields
 * '239.255.0.0', which is not a valid E1.31 universe group — frames sent there
 * multicast into a dead group and no receiver ever joins it.
 *
 * Declared locally (packages/io has no dependency on @ledrums/core); the tag
 * structurally matches Project['output']['protocol'].
 */
export type OutputProtocolTag = 'artnet' | 'sacn';

export const SACN_UNIVERSE_MIN = 1;
export const SACN_UNIVERSE_MAX = 63999;

export function universeDomain(protocol: OutputProtocolTag): { min: number; max: number } {
  return protocol === 'sacn'
    ? { min: SACN_UNIVERSE_MIN, max: SACN_UNIVERSE_MAX }
    : { min: 0, max: 32767 };
}

export function isUniverseValid(protocol: OutputProtocolTag, universe: number): boolean {
  if (!Number.isInteger(universe)) return false;
  const { min, max } = universeDomain(protocol);
  return universe >= min && universe <= max;
}
