import type { GeneratorDef } from './types';

/** Meter Generator — level displays up the hoops, from a set level or built up by hits. */
export const meterGenerator: GeneratorDef = {
  id: 'meter',
  label: 'Meter',
  description: 'A level meter up the hoops, from a set level or built up by hits.',
  icon: 'audio-lines',
  styles: [
    { id: 'eq', label: 'EQ', effectId: 'meter-eq' },
    { id: 'swing', label: 'Swing', effectId: 'swing' },
  ],
};
