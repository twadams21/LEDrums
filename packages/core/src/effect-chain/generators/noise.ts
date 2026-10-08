import type { GeneratorDef } from './types';
import { DEAD_DECAY } from './types';

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
    { id: 'lava-lamp', label: 'Lava Lamp', effectId: 'lava-lamp' },
    { id: 'caustics', label: 'Caustics', effectId: 'caustics' },
    { id: 'fire', label: 'Fire', effectId: 'fire' },
    { id: 'flicker', label: 'Flicker', effectId: 'flame-flicker', hiddenParams: DEAD_DECAY },
    { id: 'flames', label: 'Velocity Flames', effectId: 'velocity-flames', hiddenParams: DEAD_DECAY },
  ],
};
