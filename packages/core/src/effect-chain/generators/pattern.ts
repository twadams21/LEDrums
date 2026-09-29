import type { GeneratorDef } from './types';

/**
 * Pattern Generator — geometric divisions of the hoops: segments, checkers and grids. Each Style
 * hosts one existing implementation at its own defaults (spec "Generators" → Pattern).
 */
export const patternGenerator: GeneratorDef = {
  id: 'pattern',
  label: 'Pattern',
  description: 'Geometric divisions of the hoops: segments, checkers and grids.',
  icon: 'grid-3x3',
  styles: [
    { id: 'segments', label: 'Segments', effectId: 'segments' },
    { id: 'checker', label: 'Checker', effectId: 'checker-pulse' },
    { id: 'grid', label: 'Grid Glow', effectId: 'grid-glow' },
  ],
};
