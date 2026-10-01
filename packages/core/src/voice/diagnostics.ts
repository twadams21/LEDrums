import type { InputEvent } from './engine';
import type { EffectTrigger } from '../effect-chain/types';

export interface VoiceInputDescriptor {
  kind: InputEvent['kind'];
  drumId?: string;
  zone?: string;
  note?: number;
  address?: string;
  value?: number;
  velocity?: number;
  songId?: string | null;
  sectionId?: string | null;
  /** `fireEffect` intent: the authored Effect id the client asked the engine to audition. */
  effectId?: string;
}

/** Why an Effect-path fire did not spawn. */
export type EffectSkipReason =
  // The Effect's Generator kind or Style resolves to no known effect generator.
  | 'unknown-generator'
  // Retrigger `ignore`: a live voice of this Effect is still playing.
  | 'retrigger-ignore'
  // `fireEffect` named an id the active section does not contain.
  | 'no-such-effect'
  // `fireEffect` named a bypassed Effect.
  | 'bypassed';

export type VoiceDiagnostic =
  | {
      // A raw MIDI note / OSC address that matched NOTHING — no patch zone-map entry (so the
      // server forwarded it without a pad) AND no Cue Effect bound to it. Distinct from
      // `effect-missed`, which is a routed hit (a known drum zone) no Effect matched. Surfaces a
      // mis-wired input the Monitor would otherwise swallow. (S14 / doc 03.)
      kind: 'input-unrouted';
      input: VoiceInputDescriptor;
    }
  | {
      // One authored Effect fired. `input` is null for Always / Clock fires.
      kind: 'effect-fired';
      input: VoiceInputDescriptor | null;
      sectionId: string;
      effectId: string;
      trigger: EffectTrigger['kind'] | 'audition';
    }
  | {
      kind: 'effect-skipped';
      input: VoiceInputDescriptor | null;
      sectionId: string | null;
      effectId: string;
      reason: EffectSkipReason;
    }
  | {
      // A routed input (a known drum zone) that no Effect of the active section matched.
      // `sectionId` is null when no section is active.
      kind: 'effect-missed';
      input: VoiceInputDescriptor;
      sectionId: string | null;
    }
  | {
      kind: 'section-recalled';
      songId: string | null;
      sectionId: string | null;
    };

export type VoiceDiagnosticSink = (event: VoiceDiagnostic) => void;
