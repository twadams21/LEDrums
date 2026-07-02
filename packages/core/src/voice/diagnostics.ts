import type { InputEvent } from './engine';

export type GraphResolutionPath = 'pad-section' | 'pad-fallback' | 'direct-midi' | 'direct-osc' | 'fire-graph';

export interface VoiceInputDescriptor {
  kind: InputEvent['kind'];
  drumId?: string;
  zone?: string;
  note?: number;
  address?: string;
  value?: number;
  velocity?: number;
  songId?: string;
  sectionId?: string;
  /** `fireGraph` intent: the explicit graph key the client asked the engine to play. */
  graphKey?: string;
}

export type GraphMissReason =
  | 'no-active-section'
  | 'no-slot-graphs'
  | 'no-pad-fallback'
  | 'no-direct-match'
  // `fireGraph` names a graph key the current show doesn't contain (stale keyboard binding).
  | 'no-such-graph';

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
      kind: 'section-recalled';
      songId: string | null;
      sectionId: string | null;
    };

export type VoiceDiagnosticSink = (event: VoiceDiagnostic) => void;
