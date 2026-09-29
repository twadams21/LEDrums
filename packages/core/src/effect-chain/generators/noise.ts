import type { GeneratorDef } from './types';

/** Re-labels a `hue` param the underlying effect calls "Hue Base", so every Noise card reads "Hue". */
const HUE_LABEL = { hue: 'Hue' } as const;

/**
 * Noise Generator — organic, continuously moving textures and flames. Each Style hosts one
 * existing texture / flame implementation at its own defaults (spec "Generators" → Noise).
 */
export const noiseGenerator: GeneratorDef = {
  id: 'noise',
  label: 'Noise',
  description: 'Organic moving textures: plasma, clouds, lava, caustics and flames.',
  icon: 'waves',
  styles: [
    { id: 'plasma', label: 'Plasma', effectId: 'plasma' },
    { id: 'clouds', label: 'Clouds', effectId: 'perlin-clouds' },
    { id: 'lava-lamp', label: 'Lava Lamp', effectId: 'lava-lamp', paramLabels: HUE_LABEL },
    { id: 'caustics', label: 'Caustics', effectId: 'caustics', paramLabels: HUE_LABEL },
    { id: 'fire', label: 'Fire', effectId: 'fire', paramLabels: HUE_LABEL },
    { id: 'flicker', label: 'Flicker', effectId: 'flame-flicker' },
    { id: 'flames', label: 'Velocity Flames', effectId: 'velocity-flames' },
  ],
};
