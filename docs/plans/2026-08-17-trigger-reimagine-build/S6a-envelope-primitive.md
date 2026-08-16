# S6a — The envelope control: a two-handle curve primitive with live-input overlay

**Effort: opus/high (pattern-setting primitive, taste-dense) · branch `feat/envelope-control`
off `main` · PR into main.** Visual reference: `docs/proto/trigger-envelope-param.html`
**option A** on `proto/trigger-reimagine` @ `e06b726` — as amended by the verdicts doc §1 and
Trent's answers (2026-08-17): **exactly two handles**, both free in time/x AND level/y; **one
global profile** for the whole curve (per-handle profiles are dropped); **a vertical strength
slider = the curvature of the chosen profile**, greyed out for profiles with no curvature
(Linear, Snap). The prototype's "hold splits the handle" mechanic is dead — do not port it.

This control is the **first instance of a pattern** (Trent: "reimagine how we set and control
the common settings to allow creative expression") — a second and third param will adopt it.
Design the component, not the one use.

## The component

New reusable primitive in the styleguide (name it plainly, e.g. `CurveField`): an SVG plot with
two draggable round handles, the profile curve drawn between them, flat extensions outside them
(x < h0.x → y = h0.y; x > h1.x → y = h1.y).

- **Domain-agnostic.** Consumers configure axis semantics: time-domain envelope (x = ms or
  beats, y = level) AND transfer-curve (x = input velocity, y = output velocity) — S8 needs the
  latter, S6b the former. Axis labels/units/ranges are props; the maths is normalised 0..1.
- **Value shape** (export the type; S6b/S8 will reuse it):
  `{ h0: {x, y}, h1: {x, y}, profile: 'linear'|'exp'|'sCurve'|'snap', strength: 0..1 }`
  normalised 0..1; consumers own unit mapping. `snap` = flat at h0.y then step to h1.y at h1.x.
  `strength` curves `exp` (how hard it bends) and `sCurve` (shoulder steepness); meaningless →
  control DISABLED (greyed, not hidden) for `linear`/`snap`.
- **Interactions:** drag handles (pointer capture on window — see the b2b0328 proto fix for the
  repaint trap); click a handle to select it (selection drives keyboard nudging, arrow keys ±,
  shift for coarse); profile picker + strength slider apply globally. Wheel-adjust per the G3
  convention (`wheel-step.ts`, commit debounced to gesture end — one undo per gesture). Handles
  must stay round (no `preserveAspectRatio="none"` — S1 is fixing that exact bug elsewhere;
  don't reintroduce it).
- **Live-input overlay (REQUIRED — S8 depends on it):** a prop accepting a stream/array of
  recent input events `{x, y?, at}`; the control plots them as fading markers ON the curve
  (input x, and the curve's mapped output) so a drummer can watch hits land while tuning.
  Overlay is presentational only — no state writes; it must not fight handle dragging.
- **Live preview affordance** from the prototype: a small replay of the curve (pulse bar/ring)
  stays — it made the control legible.
- **Sizing:** works at inspector width (~300px) and degrades legibly to a node-face thumbnail
  (~56×32 read-only mini rendering as a separate cheap sub-component or render mode).
- Reduced-motion: markers appear/disappear without animation; no ambient motion.

## Anchors to verify

- The prototype file (reference only — verdicts override it).
- `wheel-step.ts` and a G3-era numeric field for the wheel/undo conventions.
- `envelope-editor-geom.ts` — reuse its geometry helpers if they genuinely fit; do not couple
  to the modulation envelope editor's ADSR model.
- Styleguide README (`apps/web/src/lib/styleguide/`) for how entries register.

## Scope fence

May touch: NEW component files under the appropriate `lib/` home, the styleguide entry +
`pnpm design-system` regen, unit tests for the curve maths (pure module: eval(x), profile
shapes, strength behaviour — test all four profiles at strength 0/0.5/1). Non-goals: wiring
into any real param (S6b/S8 own that), the modulation ADSR editors, core/protocol changes.

## Evidence

- Typecheck 0 + targeted vitest (the curve-maths module), committed HEAD pushed. **Do NOT run
  the full `pnpm test` sweep — orchestrator-only rule; the orchestrator sweeps at review.**
- Curve-maths unit tests as above; component renders in the styleguide.
- ui-shot of the styleguide entry (or a demo route) showing: handles + curve, strength greyed
  on Linear, live-overlay markers — `--strict`.
- Report: commit body <30 lines; one-line completion message with sha + branch.

## Escalate if

- The domain-agnostic API forces a choice that visibly worsens one consumer (name the tension,
  propose, wait).
- You believe more profiles are needed — the set is fixed tonight: linear / exp / sCurve / snap.
