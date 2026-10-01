import type { GeneratorDef } from './types';

/** Gradient Generator — hue fields that flow, rotate or sweep across the kit. */
export const gradientGenerator: GeneratorDef = {
  id: 'gradient',
  label: 'Gradient',
  description: 'A colour gradient that flows, rotates or sweeps across the kit.',
  icon: 'rainbow',
  styles: [
    { id: 'rainbow', label: 'Rainbow', effectId: 'rainbow-flow', paramLabels: { hueOffset: 'Hue' } },
    { id: 'hue-rotate', label: 'Hue Rotate', effectId: 'hue-rotate-kit', paramLabels: { baseHue: 'Hue' } },
    { id: 'temperature', label: 'Temperature', effectId: 'temp-sweep' },
  ],
};
