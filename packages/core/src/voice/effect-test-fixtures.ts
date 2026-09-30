/**
 * Test fixtures: tiny runtime Shows on the Effect model, for engine-level suites that only need
 * "a section whose Effects fire on a hit". Not part of the core surface (the barrel does not
 * export it); suites import it by path, like `runtime-test-fixtures.ts`.
 */
import { parseEffect, type Effect, type GeneratorDevice, type ModifierDevice } from '../effect-chain/types';
import type { Show, ShowSong, SongSection } from './types';

/**
 * A zone Effect on `row` / `slot` (default kick, slot 0) hosting `generator`. `over` merges
 * into the authored Effect before it is parsed, so any Effect field can be set.
 */
export function zoneEffect(
  id: string,
  generator: Partial<GeneratorDevice> & Pick<GeneratorDevice, 'kind'>,
  over: Record<string, unknown> = {},
  row = 'kick',
  slot = 0,
): Effect {
  return parseEffect({
    id,
    cell: { row, column: { kind: 'zone', slot } },
    generator,
    ...over,
  });
}

/** A runtime section. */
export function sectionOf(id: string, effects: Effect[], master?: ModifierDevice[]): SongSection {
  return { id, name: id, effects, ...(master ? { master } : {}) };
}

/** A runtime song. */
export function songOf(id: string, sections: SongSection[]): ShowSong {
  return { id, name: id, sections };
}

/**
 * A one-song Show (`song`) of `sections`. The engine seeds the first section as active on
 * `setShow`, so a hit fires its Effects without a recall.
 */
export function effectShowOf(...sections: SongSection[]): Show {
  return { songs: [songOf('song', sections)] };
}
