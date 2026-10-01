import type { GeneratorDef } from './types';

/** Wave Generator — Styles filled by effect-chains wave 2. */
export const waveGenerator: GeneratorDef = {
  id: 'wave',
  label: 'Wave',
  styles: [
    { id: 'radial', label: 'Radial', effectId: 'radial-wash' },
    { id: 'chase', label: 'Chase', effectId: 'chase-bands' },
  ],
};
