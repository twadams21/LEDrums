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
      kind: 'section-recalled';
      songId: string | null;
      sectionId: string | null;
    };

export type VoiceDiagnosticSink = (event: VoiceDiagnostic) => void;
