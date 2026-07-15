import { describe, expect, it } from 'vitest';
import {
  CLIPDOC_APP,
  CLIPDOC_PRIOR_VERSION,
  CLIPDOC_VERSION,
  isClipParseError,
  parse,
  serialize,
  type ClipDoc,
} from './clipdoc';
import { makeNode, type GraphNode, type TriggerGraph } from './sim';

/* B6 — a clip copied before A1 carries 0-based hoop targetIds. Pasting it must shift them +1 so
   the pasted clip lights the SAME physical hoop, version-gated + idempotent (mirrors the show-schema
   migrator; graph node data lives only in a graph payload and in deps.graphs). */

const hoopGraph = (targetId: string): TriggerGraph => ({
  nodes: [makeNode('effect', 'fx', 0, 0, { scope: 'hoop', targetId })],
  edges: [],
});
const firstTargetId = (g: TriggerGraph | undefined): string | undefined => (g?.nodes[0] as GraphNode | undefined)?.targetId;

const rawGraphDoc = (v: number, targetId: string) => ({
  app: CLIPDOC_APP,
  v,
  kind: 'graph',
  payload: { key: 'g', graph: hoopGraph(targetId) },
  deps: {},
  meta: { exportedAt: '' },
});

const rawSectionDoc = (v: number, targetId: string) => ({
  app: CLIPDOC_APP,
  v,
  kind: 'section',
  payload: { section: { id: 's', name: '', graphs: ['g'], looks: {} } },
  deps: { graphs: { g: hoopGraph(targetId) } },
  meta: { exportedAt: '' },
});

const parsed = (raw: unknown): ClipDoc => {
  const doc = parse(JSON.stringify(raw));
  if (isClipParseError(doc)) throw new Error(`unexpected parse error: ${doc.reason}`);
  return doc;
};

describe('parse — v1 hoop targetIds migrate to 1-based on paste', () => {
  it('shifts a v1 graph payload node +1', () => {
    const doc = parsed(rawGraphDoc(CLIPDOC_PRIOR_VERSION, 'kick#0'));
    expect(doc.kind).toBe('graph');
    if (doc.kind === 'graph') expect(firstTargetId(doc.payload.graph)).toBe('kick#1');
  });

  it('shifts a v1 dep graph (section/song closure) +1', () => {
    const doc = parsed(rawSectionDoc(CLIPDOC_PRIOR_VERSION, 'snare#0,1'));
    expect(doc.kind).toBe('section');
    if (doc.kind === 'section') expect(firstTargetId(doc.deps.graphs?.g)).toBe('snare#1,2');
  });

  it('does NOT shift a current (v2) doc (idempotent — no double shift on re-paste)', () => {
    const doc = parsed(rawGraphDoc(CLIPDOC_VERSION, 'kick#1'));
    if (doc.kind === 'graph') expect(firstTargetId(doc.payload.graph)).toBe('kick#1');
  });

  it('stamps the current version, so a re-copied migrated clip is v2 and re-parses unchanged', () => {
    const migrated = parsed(rawGraphDoc(CLIPDOC_PRIOR_VERSION, 'kick#0'));
    expect(migrated.v).toBe(CLIPDOC_VERSION);
    const reParsed = parsed(JSON.parse(serialize(migrated)));
    if (reParsed.kind === 'graph') expect(firstTargetId(reParsed.payload.graph)).toBe('kick#1'); // shifted once, end to end
  });

  it('still rejects a genuinely unsupported (newer) version', () => {
    const doc = parse(JSON.stringify(rawGraphDoc(CLIPDOC_VERSION + 1, 'kick#0')));
    expect(isClipParseError(doc)).toBe(true);
    if (isClipParseError(doc)) expect(doc.reason).toBe('unsupported-version');
  });
});
