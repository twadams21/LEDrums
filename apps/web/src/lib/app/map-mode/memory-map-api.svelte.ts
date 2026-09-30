/* An in-memory MapModeApi (effect chains S07b): the styleguide demos and the map-mode component
   tests run against it, so the overlay is exercised through the same contract the store
   implements in wave 5b, with no store, socket or MIDI port. It is a fixture, not a second
   implementation of the rules: conflicts are whatever the caller declares (`claims`) plus
   "another control already holds this source". */

import { effectChain, type GlobalControlAction } from '@ledrums/core';
import type { BindResult, MapModeApi, MapTarget } from '../../trigger-lab/map-api';

type InputMapping = effectChain.InputMapping;
type InputMappingSource = effectChain.InputMappingSource;
type InputMappingTarget = effectChain.InputMappingTarget;

export interface MemoryMapModeOptions {
  mappings?: readonly InputMapping[];
  /** Global-control bindings (the `inputMap.globalControls` stand-in). */
  globals?: Partial<Record<GlobalControlAction, InputMappingSource>>;
  /** Sources claimed elsewhere (zones, cues, reserved CCs): binding one is refused with `reason`. */
  claims?: readonly { source: InputMappingSource; reason: string }[];
  canEdit?: boolean;
  /** Called when a key mapping is performed outside map mode. */
  onPerform?: (target: MapTarget) => void;
}

export function sameSource(a: InputMappingSource, b: InputMappingSource): boolean {
  if ('midiNote' in a) return 'midiNote' in b && a.midiNote === b.midiNote;
  if ('midiCc' in a) return 'midiCc' in b && a.midiCc === b.midiCc;
  if ('oscAddress' in a) return 'oscAddress' in b && a.oscAddress === b.oscAddress;
  return 'key' in b && a.key === b.key;
}

export class MemoryMapModeApi implements MapModeApi {
  private mappings = $state<InputMapping[]>([]);
  private globals = $state<Partial<Record<GlobalControlAction, InputMappingSource>>>({});
  private learnTarget = $state<MapTarget | null>(null);
  private refusal = $state<string | null>(null);
  private readonly claims: readonly { source: InputMappingSource; reason: string }[];
  private readonly onPerform: ((target: MapTarget) => void) | undefined;
  private nextId = 1;
  readonly canEditMappings: boolean;

  constructor(options: MemoryMapModeOptions = {}) {
    this.mappings = [...(options.mappings ?? [])];
    this.globals = { ...options.globals };
    this.claims = options.claims ?? [];
    this.canEditMappings = options.canEdit ?? true;
    this.onPerform = options.onPerform;
  }

  get inputMappings(): readonly InputMapping[] {
    return this.mappings;
  }
  get mapLearnTargetId(): string | null {
    return this.learnTarget ? this.mapTargetId(this.learnTarget) : null;
  }
  get mapLearnRefusal(): string | null {
    return this.refusal;
  }

  mapTargetId(target: MapTarget): string {
    return target.kind === 'globalControl' ? `global:${target.action}` : effectChain.inputMappingTargetId(target);
  }

  bindingFor(target: MapTarget): InputMappingSource | null {
    if (target.kind === 'globalControl') return this.globals[target.action] ?? null;
    const id = this.mapTargetId(target);
    return this.mappings.find((m) => effectChain.inputMappingTargetId(m.target) === id)?.source ?? null;
  }

  bindTarget(target: MapTarget, source: InputMappingSource): BindResult {
    if (!this.canEditMappings) return { ok: false, reason: 'Viewing — another client is editing' };
    const claim = this.claims.find((c) => sameSource(c.source, source));
    if (claim) return { ok: false, reason: claim.reason };
    const id = this.mapTargetId(target);
    const holder = this.holderOf(source);
    if (holder !== null && holder !== id) {
      return { ok: false, reason: `${effectChain.inputMappingSourceLabel(source)} is already mapped to another control` };
    }
    if (target.kind === 'globalControl') {
      this.globals = { ...this.globals, [target.action]: source };
    } else {
      const rest = this.mappings.filter((m) => effectChain.inputMappingTargetId(m.target) !== id);
      const prev = this.mappings.find((m) => effectChain.inputMappingTargetId(m.target) === id);
      this.mappings = [...rest, { ...prev, id: prev?.id ?? `map-${this.nextId++}`, source, target }];
    }
    return { ok: true };
  }

  clearTarget(target: MapTarget): void {
    if (!this.canEditMappings) return;
    if (target.kind === 'globalControl') {
      if (!(target.action in this.globals)) return;
      const { [target.action]: _gone, ...rest } = this.globals;
      this.globals = rest;
      return;
    }
    const id = this.mapTargetId(target);
    this.mappings = this.mappings.filter((m) => effectChain.inputMappingTargetId(m.target) !== id);
  }

  setMappingRange(target: InputMappingTarget, rangeMin: number | undefined, rangeMax: number | undefined): void {
    if (!this.canEditMappings) return;
    const id = effectChain.inputMappingTargetId(target);
    this.mappings = this.mappings.map((m) =>
      effectChain.inputMappingTargetId(m.target) === id ? { ...m, rangeMin, rangeMax } : m,
    );
  }

  startMapLearn(target: MapTarget): void {
    this.learnTarget = target;
    this.refusal = null;
  }
  cancelMapLearn(): void {
    this.learnTarget = null;
    this.refusal = null;
  }

  /** Test / demo hook: an input arrives while learn is armed (a MIDI note, a CC, an OSC address). */
  receiveLearnInput(source: InputMappingSource): BindResult | null {
    if (!this.learnTarget) return null;
    const result = this.bindTarget(this.learnTarget, source);
    this.refusal = result.ok ? null : result.reason;
    return result;
  }

  performKeyMapping(code: string): boolean {
    const mapping = this.mappings.find((m) => 'key' in m.source && m.source.key === code);
    if (!mapping) return false;
    this.onPerform?.(mapping.target);
    return true;
  }

  private holderOf(source: InputMappingSource): string | null {
    const mapping = this.mappings.find((m) => sameSource(m.source, source));
    if (mapping) return effectChain.inputMappingTargetId(mapping.target);
    for (const [action, bound] of Object.entries(this.globals)) {
      if (bound && sameSource(bound, source)) return `global:${action}`;
    }
    return null;
  }
}
