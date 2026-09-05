import type { PixliteClient } from '@ledrums/io';
import type { ControllerTestPattern } from './ws-protocol';
import type { MonitorDraft } from './monitor';

interface ModeState {
  pattern: ControllerTestPattern | null;
  needsLive: boolean;
}

interface Owner {
  client: PixliteClient;
  host: string;
  state: ModeState;
}

/** Serializes takeover/return-to-live across controller replacement and in-flight requests.
 * Ownership is captured when a command is requested, never read again after an await. */
export function createControllerTestMode(changed: () => void, monitor?: (event: MonitorDraft) => void) {
  let current: Owner | null = null;
  // Retain only unresolved device state, not retired clients/credentials. Re-adoption can
  // recover with a fresh client. Never evict uncertainty merely because navigation changed.
  const unresolved = new Map<string, ModeState>();
  let chain = Promise.resolve();

  function enqueue(work: () => Promise<void>): Promise<void> {
    chain = chain.then(work, work);
    return chain;
  }

  function event(owner: Owner, label: string, error?: unknown): void {
    monitor?.({
      type: error === undefined ? 'output' : 'error', direction: 'out', source: 'server/controller',
      destination: owner.host, label,
      ...(error === undefined ? {} : { detail: error instanceof Error ? error.message : String(error) }),
    });
  }

  async function revert(owner: Owner, reason: 'client' | 'auto'): Promise<void> {
    if (!owner.state.needsLive) return;
    try {
      await owner.client.modeLive();
      // A failed return-to-live must remain retryable. Do not clear before acknowledgement.
      owner.state.needsLive = false;
      owner.state.pattern = null;
      if (unresolved.get(owner.host) === owner.state) unresolved.delete(owner.host);
      if (current?.state === owner.state) changed();
      event(owner, reason === 'auto' ? 'Controller back to live (auto)' : 'Controller back to live');
    } catch (err) {
      event(owner, 'Controller back-to-live failed', err);
    }
  }

  return {
    bind(client: PixliteClient, host: string): void {
      const previous = current;
      const next: Owner = {
        client, host, state: unresolved.get(host) ?? { pattern: null, needsLive: false },
      };
      current = next;
      // Same destination: use refreshed credentials, preserving state until acknowledgement.
      // Different destination: keep cleanup on the old device, never redirect it to the new one.
      if (previous) {
        const cleanup = previous.host === host ? next : previous;
        void enqueue(() => revert(cleanup, 'auto'));
      }
    },
    get pattern(): ControllerTestPattern | null { return current?.state.pattern ?? null; },
    set(pattern: ControllerTestPattern): Promise<void> {
      const owner = current;
      if (!owner) return Promise.resolve();
      return enqueue(async () => {
        if (owner !== current) return; // replacement cancelled a not-yet-started acquisition
        owner.state.needsLive = true; // even a failed response can leave the device's mode uncertain
        unresolved.set(owner.host, owner.state);
        try {
          await owner.client.modeTestData(pattern);
          owner.state.pattern = pattern;
          if (current?.state === owner.state) changed();
          event(owner, 'Controller test pattern');
        } catch (err) {
          event(owner, 'Controller test pattern failed', err);
        }
      });
    },
    backToLive(reason: 'client' | 'auto' = 'client'): Promise<void> {
      const owner = current;
      // Check needsLive INSIDE the queued action: acquisition may still be in flight now.
      return owner ? enqueue(() => revert(owner, reason)) : Promise.resolve();
    },
  };
}
