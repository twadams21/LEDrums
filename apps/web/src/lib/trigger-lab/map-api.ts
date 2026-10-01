/**
 * The MIDI-map authoring contract between the web store and the map-mode UI (effect chains S07).
 *
 * `TriggerLab` (store.svelte.ts) implements {@link MapModeApi}; the map-mode shell, overlay and
 * `mappable` attachment depend ONLY on this interface, so they can be built and demoed
 * (styleguide fixtures) independently of the store. Mutators are guarded, undoable authoring
 * edits (one undo step each), no-ops for viewers, and autosave like every other edit.
 *
 * Two kinds of mappable control:
 * - an InputMapping target (core `effect-chain/input-mappings.ts`): stored on the show;
 * - a global control (`inputMap.globalControls`): written through the existing global-control
 *   learn machinery, so Settings stays the source of truth for those bindings.
 */
import type { effectChain, GlobalControlAction } from '@ledrums/core';

type InputMapping = effectChain.InputMapping;
type InputMappingSource = effectChain.InputMappingSource;
type InputMappingTarget = effectChain.InputMappingTarget;

/** What a mappable control binds: a show mapping target, or an app global control. */
export type MapTarget = InputMappingTarget | { kind: 'globalControl'; action: GlobalControlAction };

/** How the control behaves when its binding fires (drives the badge and the learn filter). */
export type MappableKind = 'button' | 'toggle' | 'continuous';

/** Registration for the `mappable` attachment (`app/map-mode/mappable.svelte.ts`). */
export interface MappableSpec {
  target: MapTarget;
  kind: MappableKind;
  /** Accessible label for the badge / refusal message ("Kick head cell", "Snare Radial · Speed"). */
  label: string;
}

/** A refused binding: the reason is ready for display (binding-claim reason, formatted). */
export type BindResult = { ok: true } | { ok: false; reason: string };

export interface MapModeApi {
  // ---- read ----
  /** Stable identity of a map target (core `inputMappingTargetId`, or `global:<action>`). */
  mapTargetId(target: MapTarget): string;
  /** The current binding of a target, or null. */
  bindingFor(target: MapTarget): InputMappingSource | null;
  /** Every show mapping (for the overlay and conflict display). */
  readonly inputMappings: readonly InputMapping[];
  /** Whether the viewer may edit bindings. */
  readonly canEditMappings: boolean;

  // ---- write ----
  /** Bind (or re-bind) a target to a source. Refuses conflicts without changing anything. */
  bindTarget(target: MapTarget, source: InputMappingSource): BindResult;
  /** Clear a target's binding. No-op when unbound. */
  clearTarget(target: MapTarget): void;
  /** Continuous targets: the range a 0..1 input maps onto. */
  setMappingRange(target: InputMappingTarget, rangeMin: number | undefined, rangeMax: number | undefined): void;

  // ---- learn (MIDI note / CC and OSC; keys are learnt by the map-mode keyboard branch) ----
  /** Arm learn for a target: the next MIDI note / CC or OSC address binds via `bindTarget`. */
  startMapLearn(target: MapTarget): void;
  cancelMapLearn(): void;
  /** The armed learn target's id, or null. */
  readonly mapLearnTargetId: string | null;
  /** The last refusal from learn (cleared on the next arm / bind), for the armed control. */
  readonly mapLearnRefusal: string | null;

  // ---- perform ----
  /**
   * A key press outside map mode: when a mapping has `{ key: code }`, perform its target and
   * return true (the caller then stops the event). Callers skip editable targets and keyboard
   * owners before asking.
   */
  performKeyMapping(code: string): boolean;
}
