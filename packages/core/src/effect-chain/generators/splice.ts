import { resolveSpliceGenerator } from '../resolve-splice';
import type { GeneratorDef } from './types';

/**
 * Splice Generator — cuts each hoop (or drum, or the scope) into bands and shows one slot per
 * band: a colour or a nested Generator. It resolves through the existing splice machinery
 * (`resolve-splice.ts`), so it has no Styles of its own. Without a fire context it resolves
 * bpm-synced timings at 120 bpm; the Effect resolver passes the live tempo.
 */
export const spliceGenerator: GeneratorDef = {
  id: 'splice',
  label: 'Splice',
  description: 'Cut the kit into bands, each showing a colour or another generator, and move them around.',
  icon: 'scissors',
  styles: [],
  resolve: (device) => resolveSpliceGenerator(device),
};
