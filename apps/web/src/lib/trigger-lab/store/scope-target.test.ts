import { describe, expect, it } from 'vitest';
import { makeNode } from '../sim';

/* Pure store-mutator logic for setScope / setTargetId — tested against plain GraphNodes
   (no runes, no Sim) since the mutators are simple field writes guarded by kind==='play'. */

// Minimal inline replicas of the two mutators (mirrors store.svelte.ts exactly):
function setScope(node: ReturnType<typeof makeNode>, scope: 'kit' | 'drum' | 'hoop'): void {
  if (node.kind !== 'play') return;
  node.scope = scope;
  node.targetId = undefined;
}

function setTargetId(node: ReturnType<typeof makeNode>, targetId: string | undefined): void {
  if (node.kind !== 'play') return;
  node.targetId = targetId || undefined;
}

// ---- setScope ---------------------------------------------------------------

describe('setScope', () => {
  it('sets scope on a play node', () => {
    const n = makeNode('play', 'p1');
    setScope(n, 'drum');
    expect(n.scope).toBe('drum');
  });

  it('accepts hoop scope', () => {
    const n = makeNode('play', 'p1');
    setScope(n, 'hoop');
    expect(n.scope).toBe('hoop');
  });

  it('clears targetId when scope changes (stale targetId prevention)', () => {
    const n = makeNode('play', 'p1', 0, 0, { scope: 'drum', targetId: 'kick' });
    setScope(n, 'hoop');
    expect(n.scope).toBe('hoop');
    expect(n.targetId).toBeUndefined();
  });

  it('is a no-op on non-play nodes', () => {
    const n = makeNode('all', 'a1');
    setScope(n as ReturnType<typeof makeNode>, 'drum');
    expect(n.scope).toBe('kit'); // default — unchanged
  });
});

// ---- setTargetId ------------------------------------------------------------

describe('setTargetId', () => {
  it('sets a drum targetId', () => {
    const n = makeNode('play', 'p1');
    setTargetId(n, 'kick');
    expect(n.targetId).toBe('kick');
  });

  it('sets a hoop targetId', () => {
    const n = makeNode('play', 'p1');
    setTargetId(n, 'tom1#2');
    expect(n.targetId).toBe('tom1#2');
  });

  it('clears targetId when passed undefined', () => {
    const n = makeNode('play', 'p1', 0, 0, { targetId: 'kick' });
    setTargetId(n, undefined);
    expect(n.targetId).toBeUndefined();
  });

  it('clears targetId when passed empty string', () => {
    const n = makeNode('play', 'p1', 0, 0, { targetId: 'kick' });
    setTargetId(n, '');
    expect(n.targetId).toBeUndefined();
  });

  it('is a no-op on non-play nodes', () => {
    const n = makeNode('all', 'a1');
    setTargetId(n as ReturnType<typeof makeNode>, 'kick');
    expect(n.targetId).toBeUndefined();
  });
});

// ---- round-trip: scope → targetId -------------------------------------------

describe('scope + targetId round-trip', () => {
  it('drum scope + drum targetId persists correctly', () => {
    const n = makeNode('play', 'p1');
    setScope(n, 'drum');
    setTargetId(n, 'snare');
    expect(n.scope).toBe('drum');
    expect(n.targetId).toBe('snare');
  });

  it('hoop scope + hoop targetId persists correctly', () => {
    const n = makeNode('play', 'p1');
    setScope(n, 'hoop');
    setTargetId(n, 'kick#1');
    expect(n.scope).toBe('hoop');
    expect(n.targetId).toBe('kick#1');
  });

  it('switching scope clears any previously set targetId', () => {
    const n = makeNode('play', 'p1');
    setScope(n, 'drum');
    setTargetId(n, 'kick');
    expect(n.targetId).toBe('kick');
    setScope(n, 'hoop');
    // targetId was cleared by setScope
    expect(n.targetId).toBeUndefined();
    setTargetId(n, 'kick#0');
    expect(n.targetId).toBe('kick#0');
  });

  it('back to kit scope clears targetId', () => {
    const n = makeNode('play', 'p1');
    setScope(n, 'drum');
    setTargetId(n, 'kick');
    setScope(n, 'kit');
    expect(n.scope).toBe('kit');
    expect(n.targetId).toBeUndefined();
  });
});
