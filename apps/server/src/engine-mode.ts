/** Which render brain the server runs: the legacy layer/clip/binding engine or the
 * voice-bus engine (trigger graphs → voices → buses). */
export type EngineMode = 'voice' | 'legacy';

/**
 * Resolve the engine mode from the environment (INIT-01 S1).
 *
 * This lived inline at main.ts as `(process.env.LEDRUMS_ENGINE ?? '').toLowerCase() === 'voice'`,
 * inside a side-effecting entry module no test can import — so nothing could assert what the
 * SHIPPED default actually is. That is precisely how the human-facing paths (`pnpm dev`,
 * the desktop shell) came to force voice while `pnpm start` silently ran legacy.
 *
 * Semantics are today's, reproduced exactly and now provable: only the literal `voice`
 * (case-insensitive) selects voice; unset, empty, or anything else is legacy. S7 inverts
 * this default in its own single-commit-revertable change.
 */
export function resolveEngineMode(env: NodeJS.ProcessEnv): EngineMode {
  return (env.LEDRUMS_ENGINE ?? '').toLowerCase() === 'voice' ? 'voice' : 'legacy';
}
