/** Ordering identity for server-authoritative recall messages. The session id is generated at the
 * server boot boundary. Revision and sequence are only comparable inside that session. */
export interface RecallIdentity {
  sessionId: string;
  showRevision: number;
  recallSequence: number;
}

export interface AuthoritativeRecall extends RecallIdentity {
  songId: string | null;
  sectionId: string | null;
}

/** Compare two identities from the same server session. */
export function compareRecallIdentity(a: RecallIdentity, b: RecallIdentity): number {
  return a.showRevision - b.showRevision || a.recallSequence - b.recallSequence;
}
