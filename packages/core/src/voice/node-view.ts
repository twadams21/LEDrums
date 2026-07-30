/**
 * `NodeView` — a per-kind discriminated VIEW of {@link GraphNode} (primitive-obsession-0001).
 *
 * {@link GraphNode} stays exactly as it is: one flat record carrying every kind's fields, 27
 * of them optional. That is the PERSISTED shape and it is not changing here — the hydrate /
 * persistence / clipboard paths and the 27 `Partial<GraphNode>` sites all keep working against
 * it untouched. This module publishes a second, narrower way to LOOK at the same object:
 * a discriminated union with one arm per {@link NodeKind}, so a site that has already
 * established which kind it is holding can be typed against only that kind's fields.
 *
 * Every arm is built from `Pick<GraphNode, …>`, never by respelling a field's type. A field
 * therefore cannot drift between the record and the view — changing `GraphNode['bands']`
 * changes the switch arm with it, and the compiler is the thing that guarantees it rather
 * than a convention.
 *
 * The point is what becomes a COMPILE ERROR:
 *   · reading a field that does not belong to the kind you narrowed to (this is how the
 *     projection's `cc` arm came to omit `ccSource`/`oscAddress` and its `modifier` arm to
 *     omit `bypass` — primitive-obsession-0009: nothing stopped either arm reading anything);
 *   · adding a `NodeKind` without giving it an arm (assertion `_Total` below);
 *   · adding a `GraphNode` field without deciding which kind owns it (assertion `_Orphans`).
 *
 * Purely additive. This module has no consumers at the commit that introduces it, so it
 * cannot regress anything; S11 (the web projection's signature Record) and S12 (core's
 * `nodeModSource` dispatch) adopt it as its first two consumers.
 */
import type { GraphNode, NodeKind } from './types';

/** Fields every node carries whatever its kind: identity + canvas position. */
type Base = Pick<GraphNode, 'id' | 'x' | 'y'>;

/**
 * One arm: the shared {@link Base}, the literal kind that discriminates it, and exactly the
 * `GraphNode` fields that kind owns — picked from the record, never respelled. `F` defaults to
 * `never` so a kind that owns no fields of its own reads as `View<'all'>` rather than as a
 * pick of nothing.
 */
type View<K extends NodeKind, F extends keyof GraphNode = never> = Base & { kind: K } & Pick<GraphNode, F>;

/** The play/effect payload, shared by the canonical `effect` arm and its legacy `play` alias so
    the two spellings cannot drift apart — the same reason S6's signature Record shares one
    `effectSig` across both keys. The `play` arm is DELIBERATELY TEMPORARY: 11-decisions.md drops
    `'play'` from the authoring union, tracked as INIT-06 chunk 06C. */
type EffectFields =
  | 'mode'
  | 'scope'
  | 'targetId'
  | 'effectId'
  | 'playType'
  | 'canvasScene'
  | 'presetId'
  | 'busId'
  | 'params'
  | 'env'
  | 'modInputs';

/**
 * The per-kind view union. One arm per {@link NodeKind} — enforced by `_Total` below, so this
 * list cannot fall behind the union it views.
 */
export type NodeView =
  // --- flow: source + containers ---
  | View<'trigger', 'source'>
  | View<'all'>
  | View<'sequence'>
  | View<'toggle'>
  | View<'random', 'noRepeat'>
  | View<'chance', 'p'>
  | View<'switch', 'on' | 'valueMode' | 'threshold' | 'invert' | 'bands'>
  | View<'delay', 'delayMode' | 'ms' | 'division'>
  // --- media ---
  | View<'effect', EffectFields>
  | View<'play', EffectFields> // legacy persisted alias — owned by chunk 06C
  | View<'modifier', 'modifierId' | 'bypass' | 'params' | 'env' | 'modInputs'>
  | View<'mix', 'mixBlendMode'>
  // --- scope + terminal anchor ---
  | View<'scope', 'scope' | 'targetId'>
  | View<'output', 'scope' | 'targetId'>
  // --- modulation sources (MOD_SOURCE_KINDS) ---
  | View<'envelope', 'env'>
  | View<'lfo', 'lfo'>
  | View<'cc', 'ccController' | 'ccChannel' | 'ccSource' | 'oscAddress'>
  | View<'note', 'noteNumber' | 'noteChannel' | 'noteMode' | 'noteReleaseMs'>
  | View<'osc', 'oscAddress'>
  | View<'randomMod', 'randomDistribution' | 'randomSteps'>;

/** The view arm for one kind — the type a per-kind dispatch entry should take. */
export type NodeViewOf<K extends NodeKind> = Extract<NodeView, { kind: K }>;

/**
 * Look at a persisted {@link GraphNode} as a {@link NodeView}.
 *
 * This is the ONE cast in the codebase from the flat record to the per-kind view, and it lives
 * at this single seam on purpose. It is sound but not provable to the compiler: `GraphNode`
 * declares every kind's fields at once, so it is neither assignable to any single arm (its
 * `kind` is the whole union) nor is any arm assignable back to it (an arm omits the other
 * kinds' required fields) — there is no overlap for `as` to lean on, hence the `unknown` hop.
 *
 * What makes it sound is that the arms are Picks OF `GraphNode`: whatever `n.kind` turns out to
 * be at runtime, `n` genuinely carries that arm's fields with that arm's types, because they
 * were taken from `n`'s own declaration. The cast asserts the discriminant, nothing else.
 */
export function narrowNode(n: GraphNode): NodeView {
  return n as unknown as NodeView;
}

// ---- Compile-time assertions ------------------------------------------------
//
// These are the module's real tests: they fail the BUILD, not a test run. `Assert<T extends
// true>` errors on `Assert<false>` ("Type 'false' does not satisfy the constraint 'true'"), so
// each assertion below is load-bearing rather than a dead alias nobody consumes.
//
// NOT asserted, deliberately — an earlier draft carried `GraphNode & {kind:K} extends
// Extract<NodeView,{kind:K}>` as a soundness check. It is VACUOUS: the flat record is a
// structural supertype of every Pick-based arm, so it holds for ANY partition of the fields
// including one that assigns none of them, and it would therefore have caught none of the
// omissions this module exists to prevent. It was dropped rather than kept for comfort.

type Assert<T extends true> = T;

/** Every key of every arm of a union (`keyof` on a union gives only the SHARED keys). */
type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/** TOTALITY — a `NodeKind` with no arm fails to compile here. */
type _Total = Assert<Exclude<NodeKind, NodeView['kind']> extends never ? true : false>;

/** NO ORPHAN FIELDS — a field added to `GraphNode` and assigned to no kind fails to compile
    here, so the view cannot silently fall behind the record it views. */
type _Orphans = Assert<Exclude<keyof GraphNode, KeysOfUnion<NodeView>> extends never ? true : false>;

// Referenced so `verbatimModuleSyntax`/tooling treat them as used rather than strippable.
export type { _Total, _Orphans };
