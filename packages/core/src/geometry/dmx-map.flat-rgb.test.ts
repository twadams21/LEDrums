import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT } from '../model/defaults';
import { buildPixelModel } from './pixel-model';
import { buildDmxMap } from './dmx-map';

/* (c) The derived flat/loopback output (used when a kit declares no topology) can now carry a
   DEFINED RGB wiring order (B5): `buildDmxMap`'s optional `controllerRgbOrder` is stamped onto the
   synthetic output so its pixels no longer rely on the packer's own fallback. Omitting it is
   byte-identical to the historical behaviour, and stamping only annotates order — never channels. */
describe('buildDmxMap — flat-output controller rgbOrder (c)', () => {
  const model = buildPixelModel(DEFAULT_KIT); // DEFAULT_KIT ships no outputs → flat map

  const orders = (map: ReturnType<typeof buildDmxMap>) =>
    new Set(map.universes.flatMap((u) => u.pixels.map((p) => p.rgbOrder)));

  // The channel-packing skeleton (everything except the rgbOrder annotation), for equality checks.
  const skeleton = (map: ReturnType<typeof buildDmxMap>) => ({
    perPixel: map.perPixel,
    universes: map.universes.map((u) => ({
      universe: u.universe,
      channelCount: u.channelCount,
      pixels: u.pixels.map((p) => ({ id: p.id, channel: p.channel, channelsPerPixel: p.channelsPerPixel })),
    })),
  });

  it('leaves every flat-map pixel rgbOrder undefined when no controller order is given (unchanged fallback)', () => {
    expect(orders(buildDmxMap(DEFAULT_KIT, model))).toEqual(new Set([undefined]));
  });

  it('stamps the controller order onto every flat-map pixel when supplied', () => {
    expect(orders(buildDmxMap(DEFAULT_KIT, model, 'GRB'))).toEqual(new Set(['GRB']));
  });

  it('stamping the order changes ONLY the annotation — channel packing is byte-identical to the golden', () => {
    // Guards the slice invariant: for the default kit the controller order is the packer fallback,
    // so stamping it must not perturb the DMX channel map — only the rgbOrder tag differs.
    const bare = buildDmxMap(DEFAULT_KIT, model);
    const stamped = buildDmxMap(DEFAULT_KIT, model, 'RGB');
    expect(skeleton(stamped)).toEqual(skeleton(bare));
  });
});
