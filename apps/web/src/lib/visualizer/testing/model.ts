import { buildPixelModel, DEFAULT_KIT, type KitConfig } from '@ledrums/core';
import type { SerializedModel } from '../../ws/protocol-types';
import { serializePixelModel } from '@ledrums/protocol';

/** Test fixture goes through the real core geometry builder, including flips and reflections. */
export function kitModel(kit: KitConfig = DEFAULT_KIT): SerializedModel {
  const pm = buildPixelModel(kit);
  return serializePixelModel(pm);
}
export function emptyModel(): SerializedModel { return kitModel({ ...DEFAULT_KIT, drums: [] }); }
