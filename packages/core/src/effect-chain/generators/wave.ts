import type { GeneratorDef } from './types';
import { DEAD_DECAY } from './types';

/**
 * Wave Generator: motion that travels across the kit (bands, sweeps, rings, spirals, orbits,
 * fields). Each Style hosts one existing effect unchanged, so a Style's params are its effect's.
 *
 * wave-collapse is not a Style: it merged into radial-wash (the Radial Style, radial-wash's own
 * `mode: 'collapse'`). follow-hoop lives under Solid ("Simple" with a hoop delay).
 */
export const waveGenerator: GeneratorDef = {
  id: 'wave',
  label: 'Wave',
  description: 'Bands, sweeps, rings and orbits that travel across the drums.',
  icon: 'waves',
  styles: [
    { id: 'chase', label: 'Chase', effectId: 'chase-bands' },
    { id: 'scan', label: 'Scan Plane', effectId: 'scan-plane' },
    { id: 'wipe', label: 'Wipe', effectId: 'wipe-3d' },
    { id: 'radial', label: 'Radial', effectId: 'radial-wash', hiddenParams: DEAD_DECAY },
    // ripple-3d labels its travel speed "Wave Speed"; the card uses the common "Speed" label.
    { id: 'ripple', label: 'Ripple', effectId: 'ripple-3d', paramLabels: { speed: 'Speed' } },
    { id: 'pond', label: 'Ripple Pond', effectId: 'ripple-pond' },
    { id: 'sonar', label: 'Sonar', effectId: 'drum-sonar' },
    { id: 'spiral', label: 'Spiral', effectId: 'spiral' },
    { id: 'helix', label: 'Helix', effectId: 'helix' },
    { id: 'tunnel', label: 'Tunnel', effectId: 'tunnel' },
    { id: 'orbit', label: 'Orbit', effectId: 'orbit-comet' },
    { id: 'rings', label: 'Orbit Rings', effectId: 'orbit-rings' },
    { id: 'comets', label: 'Comet Trails', effectId: 'comet-trails' },
    { id: 'interference', label: 'Interference', effectId: 'interference' },
    { id: 'synced', label: 'Synced Hoops', effectId: 'synced-hoops' },
    { id: 'field', label: 'Field', effectId: 'spatial-field' },
  ],
};
