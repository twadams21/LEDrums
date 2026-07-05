import { registerCanvasScene } from './registry';
import type { CanvasElement, CanvasScene, Lens, SamplerConfig } from './types';

const canvasTags = ['canvas', 'texture', 'ambient', 'kit-wide'] as const;
const lensTags = ['canvas', 'lens', 'texture', 'ambient', 'kit-wide'] as const;
const hyperTags = ['canvas', 'lens', 'texture', 'ambient', '3d', 'kit-wide'] as const;

const stripe = (
  angleDeg: number,
  hue: number,
  widthU = 0.14,
  speedUps = 0.12,
  duty = 0.5,
  sat = 1,
  softness = 0.08,
): CanvasElement => ({ kind: 'stripes', angleDeg, widthU, duty, speedUps, hue, sat, softness });

const circle = (cx: number, cy: number, r: number, hue: number, feather = 0.08, sat = 1): CanvasElement => ({
  kind: 'circle',
  cx,
  cy,
  r,
  feather,
  hue,
  sat,
});

const gradient = (angleDeg: number, stops: CanvasElement & { kind: 'gradient' }['stops']): CanvasElement => ({
  kind: 'gradient',
  angleDeg,
  stops,
});

const checker = (cols: number, rows: number, hueA: number, hueB: number, phase = 0): CanvasElement => ({
  kind: 'checker',
  cols,
  rows,
  hueA,
  hueB,
  phase,
});

const noise = (scale: number, hue: number, speed = 0.05, octaves = 4, sat = 0.9): CanvasElement => ({
  kind: 'noise',
  scale,
  octaves,
  hue,
  sat,
  speed,
});

const poly = (cx: number, cy: number, sides: number, r: number, rotDeg: number, hue: number, feather = 0.08, sat = 1): CanvasElement => ({
  kind: 'polygon',
  cx,
  cy,
  sides,
  r,
  rotDeg,
  feather,
  hue,
  sat,
});

const cylinder: SamplerConfig = { kind: 'cylinder' };
const footprint: SamplerConfig = { kind: 'footprint' };
const strip = (angleDeg = 0, span = 1, offset = 0): SamplerConfig => ({ kind: 'strip', angleDeg, span, offset });
const hoop: SamplerConfig = { kind: 'hoop', radius: 0.115 };

function scene(
  id: string,
  name: string,
  description: string,
  sampler: SamplerConfig,
  elements: CanvasElement[],
  lenses: Lens[] = [],
  tags: readonly string[] = lenses.length ? lensTags : canvasTags,
): CanvasScene {
  return { id, name, description, tags: [...tags], sampler, lenses, elements };
}

/**
 * Built-in U6 canvas library. These are authored scene documents, registered in core so
 * `canvas:<sceneId>` resolves anywhere the EffectGenerator registry is available. User-authored
 * scenes still live in the show document; these are the day-1 built-ins.
 */
export const BUILTIN_CANVAS_SCENES: readonly CanvasScene[] = [
  scene(
    'stripe-band',
    'Stripe Band',
    'Wide rainbow bands wrap the drum cylinders as one clean field — the Resolume-style starting point for canvas looks.',
    cylinder,
    [stripe(18, 188, 0.18, 0.09, 0.55), stripe(198, 320, 0.42, -0.025, 0.22, 0.85, 0.16)],
  ),
  scene(
    'checker-spin',
    'Checker Spin',
    'A graphic checker texture rotates through the standard canvas params, giving the kit a crisp digital test-card motion.',
    cylinder,
    [checker(10, 6, 194, 314), gradient(90, [{ at: 0, hue: 230, sat: 0.7, v: 0.35 }, { at: 1, hue: 32, sat: 0.9, v: 1 }])],
  ),
  scene(
    'strip-rain',
    'Strip Rain',
    'The full pixel chain is unwound into a strip, then blue-green rain bands fall down it like a long LED tape.',
    strip(90, 1.05, 0),
    [gradient(90, [{ at: 0, hue: 218, sat: 0.9, v: 0.2 }, { at: 1, hue: 165, sat: 0.9, v: 1 }]), stripe(90, 188, 0.065, 0.32, 0.28, 1, 0.16)],
  ),
  scene(
    'hoop-orbits',
    'Hoop Orbits',
    'Each hoop is placed as a small canvas circle, then orbiting bands make the physical hoop stack read as notation on the surface.',
    hoop,
    [gradient(0, [{ at: 0, hue: 220, sat: 0.85, v: 0.25 }, { at: 1, hue: 285, sat: 0.9, v: 0.8 }]), stripe(0, 44, 0.2, 0.18, 0.32, 1, 0.08)],
  ),
  scene(
    'tunnel-rings',
    'Tunnel Rings',
    'Straight stripes become concentric rings through the polar lens — a tunnel-like payoff for the canvas lens system.',
    footprint,
    [stripe(90, 202, 0.08, 0.18, 0.45, 1, 0.1), gradient(0, [{ at: 0, hue: 255, sat: 0.9, v: 0.25 }, { at: 1, hue: 20, sat: 0.9, v: 0.95 }])],
    [{ kind: 'polar' }],
  ),
  scene(
    'polar-spokes',
    'Polar Spokes',
    'The polar lens turns horizontal striping into radial spokes, so the kit pulses like a rotating scanner seen from above.',
    footprint,
    [stripe(0, 42, 0.055, 0.08, 0.42, 1, 0.08), circle(0.5, 0.5, 0.18, 318, 0.16)],
    [{ kind: 'polar' }],
  ),
  scene(
    'unpolar-ribbons',
    'Unpolar Ribbons',
    'Angle/radius artwork is unwrapped back into Cartesian space, producing curved ribbons that bend across the drum layout.',
    footprint,
    [stripe(0, 150, 0.12, 0.08, 0.55, 0.9, 0.12), stripe(90, 282, 0.26, -0.03, 0.2, 0.8, 0.16)],
    [{ kind: 'unpolar' }],
  ),
  scene(
    'unpolar-rose',
    'Unpolar Rose',
    'A polar checker rose is projected back outward, creating flower-like cells that rotate around the whole kit footprint.',
    footprint,
    [checker(14, 5, 330, 184), circle(0.5, 0.5, 0.28, 48, 0.2)],
    [{ kind: 'unpolar' }],
  ),
  scene(
    'log-tunnel',
    'Log Tunnel',
    'Log-polar mapping turns soft stripes into an infinite zoom tunnel — self-similar rings crawl through the instrument.',
    footprint,
    [stripe(90, 214, 0.1, 0.2, 0.48, 1, 0.12), noise(7, 286, 0.04, 3, 0.65)],
    [{ kind: 'log-polar', zoom: 1.35 }],
  ),
  scene(
    'log-nebula',
    'Log Nebula',
    'Cloud noise through log-polar space becomes a warped nebula, with rings and spirals breathing from the kit centre.',
    footprint,
    [noise(9, 252, 0.07, 5, 0.82), stripe(18, 34, 0.22, -0.035, 0.18, 0.8, 0.2)],
    [{ kind: 'log-polar', zoom: 2.05 }],
  ),
  scene(
    'kaleido-bloom',
    'Kaleido Bloom',
    'A few bright circles are mirrored into a six-sector bloom, making a small scene read like a full-kit geometric flower.',
    footprint,
    [gradient(0, [{ at: 0, hue: 210, sat: 0.8, v: 0.2 }, { at: 1, hue: 310, sat: 1, v: 0.8 }]), circle(0.6, 0.46, 0.16, 332, 0.09), circle(0.44, 0.66, 0.1, 48, 0.08)],
    [{ kind: 'kaleido', sectors: 6, spinDeg: 8 }],
  ),
  scene(
    'kaleido-shards',
    'Kaleido Shards',
    'Polygon shards fold through an eight-way kaleidoscope for a sharp, prismatic look that still rides the drum geometry.',
    footprint,
    [poly(0.58, 0.48, 3, 0.26, 18, 196, 0.06), poly(0.38, 0.6, 5, 0.18, 44, 318, 0.08), stripe(140, 52, 0.16, 0.05, 0.25, 1, 0.12)],
    [{ kind: 'kaleido', sectors: 8, spinDeg: -18 }],
  ),
  scene(
    'mobius-ribbon',
    'Mobius Ribbon',
    'A conformal Mobius warp pulls stripe bands into impossible ribbon turns without adding a new renderer.',
    footprint,
    [stripe(24, 174, 0.1, 0.1, 0.42, 1, 0.1), gradient(115, [{ at: 0, hue: 280, sat: 0.9, v: 0.25 }, { at: 1, hue: 38, sat: 0.9, v: 0.95 }])],
    [{ kind: 'mobius', a: 0.62, b: -0.36 }],
  ),
  scene(
    'mobius-glass',
    'Mobius Glass',
    'Checker and gradient layers bend through a gentler Mobius lens, like glass refraction over the kit footprint.',
    footprint,
    [checker(7, 7, 186, 286), gradient(45, [{ at: 0, hue: 188, sat: 0.75, v: 0.28 }, { at: 1, hue: 328, sat: 0.9, v: 0.95 }])],
    [{ kind: 'mobius', a: -0.28, b: 0.52 }],
  ),
  scene(
    'tile-matrix',
    'Tile Matrix',
    'A small checker scene repeats into a dense matrix, useful as a graphic base layer or modulation target.',
    cylinder,
    [checker(3, 2, 120, 210), stripe(90, 58, 0.18, 0.04, 0.18, 0.8, 0.1)],
    [{ kind: 'tile', cols: 4, rows: 3 }],
  ),
  scene(
    'tile-confetti',
    'Tile Confetti',
    'Dots and polygons repeat through a tile lens, creating controlled confetti without particle state.',
    footprint,
    [circle(0.3, 0.28, 0.08, 36, 0.05), circle(0.7, 0.62, 0.1, 196, 0.06), poly(0.48, 0.44, 6, 0.12, 18, 306, 0.05)],
    [{ kind: 'tile', cols: 5, rows: 4 }],
  ),
  scene(
    'swirl-vortex',
    'Swirl Vortex',
    'The swirl lens twists stripes around the kit centre, producing a vortex that can be sped or rotated through standard scene params.',
    footprint,
    [stripe(8, 204, 0.09, 0.16, 0.45, 1, 0.12), circle(0.5, 0.5, 0.2, 310, 0.18)],
    [{ kind: 'swirl', amount: 4.8, radius: 0.68 }],
  ),
  scene(
    'swirl-petal',
    'Swirl Petal',
    'A softer swirl turns polygons and circles into petal trails, a calmer cousin of the high-energy vortex.',
    footprint,
    [poly(0.62, 0.42, 5, 0.18, 12, 22, 0.08), circle(0.38, 0.62, 0.12, 168, 0.08), gradient(0, [{ at: 0, hue: 230, sat: 0.7, v: 0.2 }, { at: 1, hue: 330, sat: 0.8, v: 0.75 }])],
    [{ kind: 'swirl', amount: -3.2, radius: 0.9 }],
  ),
  scene(
    'hyper-drift',
    'Hyper Drift',
    'Noise samples the kit through a rotating 4D hypervolume, so surfaces crawl in ways a normal 3D move cannot produce.',
    footprint,
    [noise(8, 246, 0.045, 5, 0.9), stripe(22, 316, 0.28, 0.02, 0.16, 0.65, 0.18)],
    [{ kind: 'hyper4d', rotXW: 28, rotYW: 63, rotZW: -41, wSpeed: 0.9 }],
    hyperTags,
  ),
  scene(
    'hyper-checker',
    'Hyper Checker',
    'A simple checker becomes alien when projected through the hyper4d lens; the grid seems to flow through the static drums.',
    footprint,
    [checker(8, 8, 200, 28), gradient(90, [{ at: 0, hue: 250, sat: 0.8, v: 0.25 }, { at: 1, hue: 34, sat: 0.9, v: 0.9 }])],
    [{ kind: 'hyper4d', rotXW: -46, rotYW: 34, rotZW: 72, wSpeed: 1.3 }],
    hyperTags,
  ),
];

for (const sceneDoc of BUILTIN_CANVAS_SCENES) registerCanvasScene(sceneDoc);
