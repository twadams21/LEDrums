/**
 * Canvas scene model (D4/D5) — a canvas effect is a 2D SCENE DOCUMENT sampled through a
 * placement of the kit's geometry onto that canvas. Scenes are DATA: new looks ship as
 * authored documents, never as new code paths. The scene engine hosts a scene through
 * the ONE `EffectGenerator` seam (see `scene.ts` + `ids.ts`) — no compositor fork.
 *
 * Canvas space is the unit square: u,v ∈ [0,1]. Elements paint in painter's order
 * (later elements over earlier); lenses warp (u,v) between sampler and elements,
 * applied in chain order.
 */

/** A gradient breakpoint: position along the gradient axis + HSV colour. */
export interface GradientStop {
  at: number; // 0..1 along the gradient direction
  hue: number; // degrees
  sat: number; // 0..1
  v: number; // 0..1
}

/**
 * The additive element union (v1 set). Renderers are tiny pure fns of
 * `(u, v, tSec, el) → rgb | null` in `elements.ts` — null leaves the pixel to the
 * elements below (transparent).
 */
export type CanvasElement =
  | {
      kind: 'stripes';
      /** direction the stripes travel (perpendicular to the stripe lines), degrees. */
      angleDeg: number;
      /** one stripe period, canvas units. */
      widthU: number;
      /** lit fraction of each period, 0..1. */
      duty: number;
      /** drift speed along the stripe direction, canvas units per second. */
      speedUps: number;
      hue: number;
      sat: number;
      /** edge feather as a fraction of the period, 0..1. */
      softness: number;
    }
  | { kind: 'circle'; cx: number; cy: number; r: number; feather: number; hue: number; sat: number }
  | { kind: 'gradient'; angleDeg: number; stops: GradientStop[] }
  | { kind: 'polygon'; cx: number; cy: number; sides: number; r: number; rotDeg: number; feather: number; hue: number; sat: number }
  | { kind: 'checker'; cols: number; rows: number; hueA: number; hueB: number; phase: number }
  | { kind: 'noise'; scale: number; octaves: number; hue: number; sat: number; speed: number };

/**
 * How drum geometry lands on the canvas — the four placements (D4). All derive from
 * existing `Pixel` fields (`uv`, `angleDeg`, `hoopIndex`, `indexInHoop`, `world`) — no
 * new geometry.
 */
export type SamplerConfig =
  | {
      /** Each hoop is a circle placed on the canvas; a pixel samples at its angle around
          that circle. Placement per hoop, or an auto grid when `placements` is absent. */
      kind: 'hoop';
      /** circle radius on the canvas (auto-grid mode), canvas units. */
      radius?: number;
      /** explicit per-hoop placement, keyed positionally by hoop build order across the
          rendered range; entries beyond the list fall back to the auto grid. */
      placements?: { cx: number; cy: number; r: number }[];
    }
  | {
      /** The pixel chain unwound to a straight line across the canvas (arclength by
          `hoopIndex`/`indexInHoop`). */
      kind: 'strip';
      /** line direction, degrees (0 → +u). */
      angleDeg?: number;
      /** how much of the canvas the full chain spans, 0..1 (default 1). */
      span?: number;
      /** perpendicular offset of the line from the canvas centre, canvas units. */
      offset?: number;
    }
  | {
      /** Existing `Pixel.uv` (angle × hoop-height) mapped to a canvas region. */
      kind: 'cylinder';
      /** destination region, defaults to the full canvas. */
      region?: { u0: number; v0: number; u1: number; v1: number };
    }
  | {
      /** Kit-wide planar projection (the existing planar-xz), whole kit on one canvas. */
      kind: 'footprint';
    };

/**
 * A coordinate-transform lens: a pure `(u, v, t) → (u, v)` warp applied between sampler
 * and elements, chainable and ordered (D5). `hyper4d` is the exception that samples
 * WORLD space — it lifts the pixel's world position to 4D, rotates XW/YW/ZW, projects
 * back, and derives the canvas position from the projection; defined for the
 * world-space samplers (`cylinder`/`footprint`) first.
 */
export type Lens =
  | { kind: 'polar' } //             xy → (angle, radius): stripes become rings
  | { kind: 'unpolar' } //           the inverse: rings become stripes
  | { kind: 'log-polar'; zoom: number } // infinite-zoom tunnels
  | { kind: 'kaleido'; sectors: number; spinDeg: number } // sector fold + mirror
  | { kind: 'mobius'; a: number; b: number } // conformal swirl (complex map)
  | { kind: 'tile'; cols: number; rows: number } // repeat
  | { kind: 'swirl'; amount: number; radius: number }
  | { kind: 'hyper4d'; rotXW: number; rotYW: number; rotZW: number; wSpeed: number };

/** An authored canvas scene document. Seed library ships in core (U6); user-authored
    scenes live in the show document — both clipboard-portable authored objects. */
export interface CanvasScene {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  /** painter's order — later elements paint over earlier ones. */
  elements: CanvasElement[];
  sampler: SamplerConfig;
  /** coordinate-transform chain, applied in order (D5). */
  lenses?: Lens[];
}
