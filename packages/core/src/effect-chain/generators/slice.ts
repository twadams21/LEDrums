import { resolveSpliceGenerator } from '../resolve-splice';
import type { GeneratorDef } from './types';

/**
 * Slice Generator — Splice cut through 3D space: slabs stacked along a tilted axis, each
 * showing a colour or a nested Generator. Same machinery and motion as Splice
 * (`resolve-splice.ts`), no Styles of its own.
 */
export const sliceGenerator: GeneratorDef = {
  id: 'slice',
  label: 'Slice',
  description: 'Slice the kit through space into slabs, each showing a colour or another generator.',
  icon: 'layers',
  styles: [],
  resolve: (device) => resolveSpliceGenerator(device),
};
