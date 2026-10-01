import type { InputEvent } from './engine';
import type { EffectTrigger } from '../effect-chain/types';

export type GraphResolutionPath = 'pad-section' | 'pad-fallback' | 'direct-midi' | 'direct-osc' | 'fire-graph';

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
  /** `fireGraph` intent: the explicit graph key the client asked the engine to play. */
  graphKey?: string;
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

export type GraphMissReason =
  | 'no-active-section'
  | 'no-slot-graphs'
  | 'no-pad-fallback'
  | 'no-direct-match'
  // `fireGraph` names a graph key the current show doesn't contain (stale keyboard binding).
  | 'no-such-graph'
  // `fireGraph` names a graph that exists, but the viewer cannot select in the active section.
  | 'not-active-section';

export type VoiceDiagnostic =
  | {
      kind: 'input-resolved';
      input: VoiceInputDescriptor;
      path: GraphResolutionPath;
      graphKey: string;
      statePrefix: string;
    }
  | {
      kind: 'graph-fired';
      input: VoiceInputDescriptor;
      path: GraphResolutionPath;
      graphKey: string;
      statePrefix: string;
      actionCount: number;
      playEffects: string[];
    }
  | {
      kind: 'graph-missed';
      input: VoiceInputDescriptor;
      reason: GraphMissReason;
    }
  | {
      // A raw MIDI note / OSC address that matched NOTHING — no patch zone-map entry (so the
      // server forwarded it without a pad) AND no authored graph bound to it by trigger source.
      // Distinct from `graph-missed`, which is a routed hit (a known drum zone) whose active
      // section simply holds no graph. Surfaces a mis-wired input the Monitor would otherwise
      // swallow. (S14 / doc 03.)
      kind: 'input-unrouted';
      input: VoiceInputDescriptor;
    }
  | {
      // A sequence node's own reset binding matched this input: its step position was cleared
      // (across every state prefix it runs under — see `isResetStateKey`). Not a graph fire;
      // nothing plays from this. One event per matched node.
      kind: 'sequence-reset';
      input: VoiceInputDescriptor;
      graphKey: string;
      nodeId: string;
    }
  | {
      // Effect path: one authored Effect fired. `input` is null for Always / Clock fires.
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
      // Effect path: a routed input (a known drum zone) that no Effect of the section matched.
      kind: 'effect-missed';
      input: VoiceInputDescriptor;
      sectionId: string;
    }
  | {
      kind: 'section-recalled';
      songId: string | null;
      sectionId: string | null;
    };

export type VoiceDiagnosticSink = (event: VoiceDiagnostic) => void;
