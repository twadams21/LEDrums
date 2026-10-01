import type { GeneratorDef } from './types';

/**
 * Particles Generator — discrete moving points: bursts, sparks, stars, rain, orbiting bodies.
 * Each Style hosts one existing particle implementation at its own defaults
 * (spec "Generators" → Particles).
 */
export const particlesGenerator: GeneratorDef = {
  id: 'particles',
  label: 'Particles',
  description: 'Bursts, sparks, stars, rain and orbiting bodies.',
  icon: 'sparkles',
  styles: [
    { id: 'confetti', label: 'Confetti', effectId: 'confetti-burst' },
    { id: 'sparkler', label: 'Sparkler', effectId: 'sparkler' },
    { id: 'starfield', label: 'Starfield', effectId: 'starfield' },
    { id: 'rain', label: 'Rain', effectId: 'rain-3d' },
    { id: 'drops', label: 'Gravity Drops', effectId: 'gravity-drops' },
    { id: 'wells', label: 'Gravity Wells', effectId: 'gravity-wells' },
    { id: 'collisions', label: 'Collisions', effectId: 'collisions' },
    { id: 'accumulate', label: 'Accumulate', effectId: 'pixel-accum' },
    { id: 'hogs', label: 'Sacred HOGs', effectId: 'sacred-hogs' },
  ],
};
