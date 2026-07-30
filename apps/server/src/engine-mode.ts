/** Which render brain the server runs: the legacy layer/clip/binding engine or the
 * voice-bus engine (trigger graphs → voices → buses). */
export type EngineMode = 'voice' | 'legacy';

/**
 * Resolve the engine mode from the environment (INIT-01 S1, default flipped in S7).
 *
 * This lived inline in main.ts, a side-effecting entry module no test can import — so nothing
 * could assert what the SHIPPED default actually was. That is precisely how the human-facing
 * paths (`pnpm dev`, the desktop shell) came to force voice while `pnpm start`, the shipped
 * prod-server script, silently ran the legacy loop.
 *
 * S7 inverted it: **voice is the default**, and only the literal `legacy` (case-insensitive)
 * opts out. Unset, empty, or an unrecognised value all mean voice — an unreadable LEDRUMS_ENGINE
 * can no longer quietly downgrade a live rig to the other engine.
 *
 * The legacy stack is still fully present behind that explicit opt-out; S12/S13 delete it.
 */
export function resolveEngineMode(env: NodeJS.ProcessEnv): EngineMode {
  return (env.LEDRUMS_ENGINE ?? '').toLowerCase() === 'legacy' ? 'legacy' : 'voice';
}
