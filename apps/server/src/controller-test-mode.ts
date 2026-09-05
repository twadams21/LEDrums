import type { PixliteClient } from '@ledrums/io';
import type { ControllerTestPattern } from './ws-protocol';
import type { MonitorDraft } from './monitor';

interface Owner {
  client: PixliteClient;
  host: string;
  pattern: ControllerTestPattern | null;
  needsLive: boolean;
}

/** Serializes takeover/return-to-live across controller replacement and in-flight requests.
 * Ownership is captured when a command is requested, never read again after an await. */
export function createControllerTestMode(changed: () => void, monitor?: (event: MonitorDraft) => void) {
  let current: Owner | null = null;
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
    if (!owner.needsLive) return;
    try {
      await owner.client.modeLive();
      // A failed return-to-live must remain retryable. Do not clear before acknowledgement.
      owner.needsLive = false;
      owner.pattern = null;
      if (current === owner) changed();
      event(owner, reason === 'auto' ? 'Controller back to live (auto)' : 'Controller back to live');
    } catch (err) {
      event(owner, 'Controller back-to-live failed', err);
    }
  }

  return {
    bind(client: PixliteClient, host: string): void {
      const previous = current;
      current = { client, host, pattern: null, needsLive: false };
      // Queued after any old acquisition, before any future command for the new client.
      if (previous) void enqueue(() => revert(previous, 'auto'));
    },
    get pattern(): ControllerTestPattern | null { return current?.pattern ?? null; },
    set(pattern: ControllerTestPattern): Promise<void> {
      const owner = current;
      if (!owner) return Promise.resolve();
      return enqueue(async () => {
        if (owner !== current) return; // replacement cancelled a not-yet-started acquisition
        owner.needsLive = true; // even a failed response can leave the device's mode uncertain
        try {
          await owner.client.modeTestData(pattern);
          owner.pattern = pattern;
          if (current === owner) changed();
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
