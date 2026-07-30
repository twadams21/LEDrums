import { describe, expect, it, vi } from 'vitest';
import { createAppKeyHandler, type AppKeyShell, type AppKeyStore } from './app-keys';

function key(k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean }> = {}) {
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...mods,
  };
}

function harness(blocked: boolean) {
  const undo = vi.fn();
  const store: AppKeyStore = {
    selectedGraph: { nodes: [{ id: 'n1', kind: 'effect' }] },
    removeNode: vi.fn(),
    fireSectionGraph: vi.fn(),
    activeSong: { sections: [{ id: 's1' }, { id: 's2' }] },
    arrangement: { activeSectionId: 's1' },
    setActiveSection: vi.fn(),
  };
  const shell: AppKeyShell = {
    selection: { kind: 'node', nodeId: 'n1' },
    clearSelection: vi.fn(),
  };
  const onKey = createAppKeyHandler({
    blocked: () => blocked,
    shortcuts: [{ combo: 'mod+z', description: 'Undo', run: undo }],
    platform: 'other',
    store,
    shell,
  });
  return { onKey, store, shell, undo };
}

describe('createAppKeyHandler blocking guard (review B1)', () => {
  it('while an unacked recovery banner is up, NO key reaches anything', () => {
    const { onKey, store, shell, undo } = harness(true);
    onKey(key('1')); // would fire live output
    onKey(key('0'));
    onKey(key('Delete')); // would remove the selected node
    onKey(key('Backspace'));
    onKey(key('z', { ctrlKey: true })); // would undo
    onKey(key('ArrowRight')); // would change the live section
    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(store.removeNode).not.toHaveBeenCalled();
    expect(store.setActiveSection).not.toHaveBeenCalled();
    expect(shell.clearSelection).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it('unblocked, the same keys reach the shell (the guard is the ONLY difference)', () => {
    const { onKey, store, undo } = harness(false);
    onKey(key('1'));
    expect(store.fireSectionGraph).toHaveBeenCalledWith(0);
    onKey(key('z', { ctrlKey: true }));
    expect(undo).toHaveBeenCalled();
    onKey(key('Delete'));
    expect(store.removeNode).toHaveBeenCalledWith({ id: 'n1', kind: 'effect' });
    onKey(key('ArrowRight'));
    expect(store.setActiveSection).toHaveBeenCalledWith('s2');
  });
});
