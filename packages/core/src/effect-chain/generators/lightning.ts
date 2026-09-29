import type { GeneratorDef } from './types';

/** Lightning Generator — electric strikes and arcs between drums. */
export const lightningGenerator: GeneratorDef = {
  id: 'lightning',
  label: 'Lightning',
  description: 'Electric bolts on the struck drum, or sparks arcing across the kit.',
  icon: 'zap',
  styles: [
    { id: 'bolt', label: 'Bolt', effectId: 'lightning' },
    { id: 'arc', label: 'Spark Arc', effectId: 'spark-arc' },
  ],
};
