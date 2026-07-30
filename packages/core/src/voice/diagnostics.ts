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
      // Authored content names a modifier or generator id no registry holds. The render path
      // still SKIPS it silently (it must never fault on stale authored data) — this arm is the
      // one observation that turns that silent skip into something the Monitor can show.
      // Emitted on FIRST sight per id only, and re-armed on `setShow`. (INIT-01 S14 /
      // resilience-hole-0011.) Server-scoped: hosts without a diagnostic sink keep today's
      // silent skip.
      kind: 'unresolved-id';
      idKind: 'modifier' | 'generator';
      id: string;
    }
  | {
      kind: 'section-recalled';
      songId: string | null;
      sectionId: string | null;
    };

export type VoiceDiagnosticSink = (event: VoiceDiagnostic) => void;

/**
 * The render path's report of an id it just skipped. Threaded down as an OPTIONAL callback
 * (compositor → generator bridge → modifier chain) rather than added to the `RenderEngine`
 * interface: widening the interface would oblige `createNullEngine` and leave browser-hosted
 * render paths with no sink. Absent ⇒ the skip stays silent, byte-for-byte as before.
 */
export type UnresolvedIdSink = (idKind: 'modifier' | 'generator', id: string) => void;
