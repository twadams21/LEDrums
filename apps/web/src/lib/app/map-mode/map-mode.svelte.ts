/* The map-mode controller (effect chains S07b): which control is armed, the last refusal, and
   the verbs the overlay (clicks) and the app keyboard dispatcher (keys) drive. It depends only
   on MapModeApi, so the styleguide and tests run it over the in-memory fixture. */

import { effectChain } from '@ledrums/core';
import type { MapModeApi, MappableSpec, MapTarget } from '../../trigger-lab/map-api';
import type { MapKeySession } from './map-keys';

type InputMappingSource = effectChain.InputMappingSource;

/** How one control reads in the overlay. */
export type MapControlState = 'idle' | 'mapped' | 'armed' | 'conflict';

/** The shell surface the overlay needs (ShellStore satisfies it; demos pass a stub). */
export interface MapModeShell {
  readonly mapMode: boolean;
  setMapMode(on: boolean): void;
  readonly mapSession?: MapKeySession | null;
  setMapSession?(session: MapKeySession | null): void;
}

export interface ArmedControl {
  readonly id: string;
  readonly spec: MappableSpec;
}

export class MapModeController implements MapKeySession {
  private armedControl = $state.raw<ArmedControl | null>(null);
  /** A key-learn refusal (MIDI / OSC refusals come from the api's `mapLearnRefusal`). */
  private keyRefusal = $state<string | null>(null);

  private readonly getApi: () => MapModeApi;

  constructor(getApi: () => MapModeApi) {
    this.getApi = getApi;
  }

  private get api(): MapModeApi {
    return this.getApi();
  }

  get armed(): ArmedControl | null {
    return this.armedControl;
  }

  /** The refusal to show on the armed control, or null. */
  get refusal(): string | null {
    if (!this.armedControl) return null;
    return this.keyRefusal ?? this.api.mapLearnRefusal;
  }

  idOf(target: MapTarget): string {
    return this.api.mapTargetId(target);
  }

  bindingOf(target: MapTarget): InputMappingSource | null {
    return this.api.bindingFor(target);
  }

  /** "Note 60", "CC 21", "/osc/x", "Key Q", or null when unbound. */
  bindingLabel(target: MapTarget): string | null {
    const source = this.api.bindingFor(target);
    return source ? effectChain.inputMappingSourceLabel(source) : null;
  }

  stateOf(spec: MappableSpec): MapControlState {
    if (this.armedControl && this.armedControl.id === this.idOf(spec.target)) {
      return this.refusal ? 'conflict' : 'armed';
    }
    return this.api.bindingFor(spec.target) ? 'mapped' : 'idle';
  }

  /** Arm a control: the next MIDI note / CC, OSC address or key binds to it. Viewers cannot arm. */
  arm(spec: MappableSpec): void {
    if (!this.api.canEditMappings) return;
    this.armedControl = { id: this.idOf(spec.target), spec };
    this.keyRefusal = null;
    this.api.startMapLearn(spec.target);
  }

  disarm(): void {
    if (!this.armedControl) return;
    this.armedControl = null;
    this.keyRefusal = null;
    this.api.cancelMapLearn();
  }

  // ---- MapKeySession ----

  learnKey(code: string): void {
    const armed = this.armedControl;
    if (!armed) return;
    const result = this.api.bindTarget(armed.spec.target, { key: code });
    this.keyRefusal = result.ok ? null : result.reason;
  }

  clearArmed(): void {
    const armed = this.armedControl;
    if (!armed) return;
    this.api.clearTarget(armed.spec.target);
    this.keyRefusal = null;
  }

  performKey(code: string): boolean {
    return this.api.performKeyMapping(code);
  }

  isKeyMapped(code: string): boolean {
    return this.api.inputMappings.some((m) => 'key' in m.source && m.source.key === code);
  }

  reset(): void {
    this.disarm();
  }
}
