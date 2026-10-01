import type { GeneratorDef } from './types';
import { DEAD_DECAY } from './types';

/**
 * Solid Generator — flat and near-flat colour looks. follow-hoop has no Style of its own: it is
 * the Simple Style with whole-drum's `hoopDelayMs` above 0 (spec "Merges Trent approved").
 */
export const solidGenerator: GeneratorDef = {
  id: 'solid',
  label: 'Solid',
  description: 'One colour on the target — steady, struck or slowly breathing.',
  icon: 'square',
  styles: [
    { id: 'solid', label: 'Solid', effectId: 'solid-colour' },
    { id: 'simple', label: 'Simple', effectId: 'whole-drum', hiddenParams: DEAD_DECAY },
    { id: 'kit', label: 'Whole Kit', effectId: 'whole-kit', hiddenParams: DEAD_DECAY },
    { id: 'swirl', label: 'Swirl', effectId: 'solid-base' },
    { id: 'breathe', label: 'Breathe', effectId: 'breathing-kit' },
  ],
};
