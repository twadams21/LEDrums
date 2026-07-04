/*
 * Effect metadata (D1) — descriptions + tags for the whole library, in ONE place so the
 * gallery, the inspector and the collection derivation read a single source. The registry
 * merges these onto each generator at build time (so `EffectGenerator.description` / `.tags`
 * are populated without touching 45 impl files). Descriptions are written like the Gen-3
 * blurbs: what it does + why it's cool on THIS kit.
 *
 * Tags come from the controlled vocabulary (`vocabulary.ts`) — the type binds them.
 * `deprecated` is left to U3 (the retire/merge pass); U1 keeps the whole library live.
 *
 * Pure core module: no Node/DOM/IO.
 */

import type { EffectTag } from './vocabulary';

export interface EffectMetadata {
  description: string;
  tags: readonly EffectTag[];
  deprecated?: { replacedBy: string; note?: string };
}

export const EFFECT_METADATA: Readonly<Record<string, EffectMetadata>> = {
  // --- Hits: per-strike events on the struck drum -----------------------------
  'whole-drum': {
    description: 'A hit lights every pixel of the struck drum at once, then fades — the simplest, most legible way to make a single drum flash to the beat you play.',
    tags: ['hit', 'per-drum'],
  },
  'whole-kit': {
    description: 'Any hit lights the entire kit as one body and fades — the whole rig punches together, so a single strike reads across all four drums at once.',
    tags: ['hit', 'kit-wide'],
  },
  burst: {
    description: 'A hit lights the whole drum; hit harder and it starts brighter AND lingers longer — the velocity you play is written straight into how long the light hangs.',
    tags: ['hit', 'per-drum'],
    deprecated: { replacedBy: 'radial-wash', note: 'Merged into 3D Radial Wash — its per-hit pop is the "Pop" preset (short reach + fast decay).' },
  },
  'follow-hoop': {
    description: 'A hit lights the bottom hoop instantly and each hoop above follows on a delay, so the light visibly climbs the drum — a cascade that turns one strike into vertical motion.',
    tags: ['hit', 'hoop-aware', 'per-drum'],
  },
  'pixel-accum': {
    description: 'Each hit sprays a few random pixels to full and everything decays, so fast playing builds a shimmering crust of light across the drum. Seeded — the same groove replays identically.',
    tags: ['hit', 'per-drum', 'sparkle', 'stateful', 'seeded'],
  },
  swing: {
    description: 'Each hit tops up a per-drum energy that decays every frame — time your hits like pushing a swing and the light keeps climbing; let it ride and it falls back.',
    tags: ['hit', 'per-drum', 'stateful'],
  },
  'velocity-flames': {
    description: 'Each drum grows a flame from the bottom hoop whose height tracks your most-recent hit velocity, flickering hot white at the base to deep red at the tip — play harder, burn taller.',
    tags: ['hit', 'per-drum', 'hoop-aware'],
  },
  'colour-melody': {
    description: 'Every note maps to its own hue across the kit and holds until the next note — play a melody and the rig walks through the colour wheel with you.',
    tags: ['hit', 'kit-wide'],
    deprecated: { replacedBy: 'whole-drum', note: 'Folded into Whole Drum — enable its "Note Hue" toggle to colour each hit by the note played.' },
  },
  chase: {
    description: 'One hoop lights at a time, arpeggiating up the drum on a beat subdivision — a 16th-note runner that keeps stepping through the hoops in time.',
    tags: ['band', 'hit', 'hoop-aware', 'per-drum', 'beat-synced'],
    deprecated: { replacedBy: 'chase-bands', note: 'Superseded by Chase Bands — emission-based bands that layer per hit instead of one global step.' },
  },
  'chase-bands': {
    description: 'Every hit launches a band of light that races around the struck drum, sized and paced musically. Hits layer — strike four beats running and four evenly-spaced bands chase each other around the hoop.',
    tags: ['band', 'hit', 'hoop-aware', 'per-drum', 'beat-synced', 'emission'],
  },
  strobe: {
    description: 'The whole kit hard-flashes on and off at a fixed rate — a momentary, high-energy strobe that snaps the entire rig in and out in sync.',
    tags: ['strobe', 'hit', 'kit-wide', 'beat-synced'],
  },

  // --- Waves & Ripples: travelling fronts and bands ---------------------------
  'radial-wash': {
    description: 'An expanding wave of colour sweeps out from the hit (or collapses inward / bounces), washing the kit in a single travelling front — the classic reactive bloom.',
    tags: ['wave', 'wash', 'kit-wide', 'emission'],
  },
  'ripple-3d': {
    description: 'Every hit detonates a spherical wavefront in WORLD space from the struck drum — it expands through the air and washes across the OTHER drums as it reaches them, so the kit reads as one physical object in a room, not four separate screens.',
    tags: ['wave', '3d', 'kit-wide', 'airspace', 'emission'],
  },
  'wave-collapse': {
    description: 'A hit fires a shell that starts wide, collapses inward to a point, then explodes back out — an implosion-then-burst that gives each strike a wound-up snap of anticipation.',
    tags: ['wave', '3d', 'kit-wide', 'emission'],
  },
  'wipe-3d': {
    description: 'A plane sweeps through the kit along any axis: a bright band rides the plane while everything it has passed stays lit — a clean directional wipe across real 3D space.',
    tags: ['wave', '3d', 'kit-wide'],
  },
  'orbit-rings': {
    description: 'A horizontal ring-plane orbits up and down through the kit; pixels within its width light up, hued by their angle — a glowing band that endlessly sweeps the whole rig vertically.',
    tags: ['wave', '3d', 'kit-wide'],
  },
  'synced-hoops': {
    description: 'A hue/brightness wave climbs the hoop levels driven purely by beat, so "Hoop 1 is Hoop 1 on every drum" — the same level renders identically across the kit and the whole rig pulses in register.',
    tags: ['wave', 'hoop-aware', 'kit-wide', 'beat-synced'],
  },
  helix: {
    description: 'A double-helix band spirals vertically through the whole kit — each pixel\'s phase mixes its height, its angle and time, so two rainbow strands climb and twist as one continuous ribbon.',
    tags: ['band', 'wave', '3d', 'kit-wide'],
  },

  // --- Particles & Air: discrete points, gaps included ------------------------
  starfield: {
    description: 'A fixed field of seeded stars twinkles across the pixels, each on its own phase — a near-white, faintly tinted deep-space wash that shimmers without ever repeating in lockstep.',
    tags: ['particle', 'ambient', 'sparkle', 'kit-wide', 'stateful', 'seeded'],
  },
  'comet-trails': {
    description: 'Comets streak around each drum\'s hoops leaving fading tails, each one a slightly different hue and heading — a restless, glittering orbit that never settles.',
    tags: ['particle', 'per-drum', 'hoop-aware'],
  },
  lightning: {
    description: 'Forked bolts arc across the kit\'s pixels from a strike, branching to nearby pixels before flashing out — jagged, electric, and gone in an instant. Seeded for exact replay.',
    tags: ['particle', '3d', 'kit-wide', 'emission', 'seeded'],
  },
  'confetti-burst': {
    description: 'Each hit throws a cloud of coloured particles from the struck drum\'s origin, launched every direction and pulled down by gravity — a physical little celebration that scatters and fades per strike.',
    tags: ['particle', 'hit', 'per-drum', 'emission', 'stateful', 'seeded'],
  },
  'spark-arc': {
    description: 'A hit hurls a spark along a 3D arc from the struck drum to another, trailing sparks through the air and landing in a flash — cross-drum travel you can actually follow through the negative space.',
    tags: ['particle', '3d', 'airspace', 'emission', 'seeded'],
  },
  'rain-3d': {
    description: 'Drops of light fall through the kit\'s real airspace, each lighting whatever pixel it passes nearest — a drop streaks down a shell, vanishes in the gap, and catches the next drum below. Play harder and it pours.',
    tags: ['particle', '3d', 'airspace', 'emission', 'stateful', 'seeded'],
  },
  'gravity-wells': {
    description: 'A handful of attractors drift on slow seeded paths through the kit\'s volume; every pixel is coloured by its nearest well — closer is brighter — so soft blobs of light glide through the whole rig.',
    tags: ['particle', 'airspace', '3d', 'wash', 'stateful', 'seeded'],
  },
  collisions: {
    description: 'Points orbit each drum in opposite directions; when two meet at the same angle a flash blooms and decays — a mechanical little firework triggered by the geometry itself.',
    tags: ['particle', 'per-drum', 'wash'],
  },

  // --- Textures: continuous 2D fields on the drum surfaces --------------------
  plasma: {
    description: 'Classic multi-sine plasma wrapped around each drum — several sine layers churn into a smoothly shifting field where colour and brightness move together. A warm, hypnotic backdrop.',
    tags: ['texture', 'ambient', 'per-drum'],
  },
  fire: {
    description: 'A rising fire texture licking up each drum shell — deterministic hash noise fed upward into a hot black-red-orange-yellow palette, flickering like a real flame with no RNG drift.',
    tags: ['texture', 'ambient', 'per-drum'],
  },
  'ripple-pond': {
    description: 'Concentric ripples spread from a slowly drifting centre across the kit\'s floor plane, seen from above like a pond — rings of brightness with hue that bleeds outward from the source.',
    tags: ['texture', '3d', 'kit-wide'],
  },
  'rainbow-flow': {
    description: 'A diagonal rainbow scrolls around each drum — hue runs along (u+v) so the bands sit on the diagonal and the whole field drifts. Exposes a rainbow offset + saturation instead of a single hue.',
    tags: ['texture', 'ambient', 'per-drum'],
  },
  tunnel: {
    description: 'A polar zoom across the kit\'s plane: hue spins with the angle while brightness pulses with 1/r, so rings appear to rush toward or away from the centre like a receding tunnel.',
    tags: ['texture', 'ambient', 'kit-wide'],
  },
  'checker-pulse': {
    description: 'A checkerboard wrapped around each drum slowly rotates; "on" cells glow full while "off" cells breathe in and out with a sine, and the hue cycles across the whole board — a graphic, pulsing grid.',
    tags: ['texture', 'ambient', 'per-drum'],
  },
  'perlin-clouds': {
    description: 'Soft Perlin-noise clouds drift across each drum — smooth, organic billows of colour with no hard edges, the calmest of the texture backdrops.',
    tags: ['texture', 'ambient', 'per-drum'],
  },
  'lava-lamp': {
    description: 'Metaball blobs drift on slow sine paths in the kit\'s plane; their summed field is thresholded into a warm red-orange-yellow palette — a genuine lava lamp stretched across the rig.',
    tags: ['texture', 'ambient', 'kit-wide'],
  },
  interference: {
    description: 'Two sine gratings rotate against each other at slightly different frequencies, beating into shifting moiré bands around each drum — a mesmerising interference pattern that never quite lands.',
    tags: ['texture', 'ambient', 'per-drum'],
  },
  caustics: {
    description: 'Water caustics ripple across the kit floor — scrolling layers summed and sharpened into bright veins of blue-cyan-white, exactly the light you see on the bottom of a pool.',
    tags: ['texture', 'ambient', 'kit-wide'],
  },
  spiral: {
    description: 'Rotating spiral arms sweep the kit\'s plane, arm count and twist tunable — brightness peaks on the arms and hue shifts across the bands, a slow galactic pinwheel over the whole rig.',
    tags: ['texture', 'ambient', 'kit-wide'],
  },
  'grid-glow': {
    description: 'A glowing neon grid wrapped around each drum — vertical and horizontal lines pulse with a soft falloff, part Tron, part graph paper, wrapping the cylinder in light.',
    tags: ['texture', 'ambient', 'per-drum'],
  },

  // --- Ambient & Base: always-on backdrops and slow washes --------------------
  'solid-base': {
    description: 'An always-on base layer that slowly swirls in 3D over the kit and never goes fully dark — the "content that lives underneath everything", quietly moving so the rig is never a black box.',
    tags: ['ambient', 'wash', '3d', 'kit-wide'],
  },
  'breathing-kit': {
    description: 'The whole kit slowly breathes — one sine LFO drives brightness in and out while the hue drifts gently — so the rig pulses as a single calm body between the action.',
    tags: ['ambient', 'wash', 'kit-wide'],
  },
  'hue-rotate-kit': {
    description: 'A full saturated wash whose hue rotates continuously and also shifts with world height, so a colour band slides up the rig as it cycles — simple, rich, and endlessly moving.',
    tags: ['ambient', 'wash', '3d', 'kit-wide'],
  },
  'temp-sweep': {
    description: 'A colour-temperature gradient (warm ↔ cool) sweeps along the kit\'s depth over time — a travelling thermal wave washing the rig front to back, blending two hue endpoints rather than one colour.',
    tags: ['ambient', 'wash', '3d', 'kit-wide'],
  },
  sidechain: {
    description: 'A steady full-kit fill that DUCKS to black on every trigger and recovers — the classic sidechain pump, so the base visibly gives way each time you hit and swells back between.',
    tags: ['ambient', 'wash', 'kit-wide'],
  },
  'sacred-hogs': {
    description: 'A reverent wash with a sparkling halo on the top hoop — a slow, ceremonial glow crowned by twinkle, built as the kit\'s "hymn" look.',
    tags: ['wash', 'sparkle', 'hoop-aware', 'kit-wide'],
  },

  // --- Meters & Utility -------------------------------------------------------
  'meter-eq': {
    description: 'Hoops light up to a level like a graphic-EQ segment display — wire it to volume or velocity and each drum becomes a vertical meter tracking the mix in real time.',
    tags: ['meter', 'hoop-aware', 'per-drum'],
  },
};
